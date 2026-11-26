import type { Client } from "@libsql/client";
import { embed, vectorSearchIds } from "@/lib/cloudflare";
import { prenotaQueryVectorize } from "@/lib/ai/vectorize";
import { docUrl, fmtAnno } from "@/lib/docs";
import { normalizza, type Concetto } from "./espansione";

/**
 * Recupero ESAUSTIVO delle fonti per lo Studio Normativo.
 *
 * Niente LIMIT bassi: ogni concetto interroga l'indice FTS fino a 1500
 * documenti, e un canale semantico (Vectorize) recupera le fonti che parlano
 * dell'argomento con parole diverse. Poi un punteggio spiegabile (bm25,
 * copertura dei concetti, titolo, gerarchia della fonte) ordina tutto e una
 * selezione con garanzie decide quali fonti analizzare in dettaglio: le
 * altre restano nell'indice come "menzioni", con il loro estratto.
 */

const MAX_PER_CONCETTO = 1500;
/** Fonti elencate nel dossier (le piu' rilevanti, se di piu'). */
export const MAX_FONTI = 600;
/** Fonti analizzate in dettaglio dal modello. */
export const MAX_ANALIZZATE = 56;
const SOGLIA_SEMANTICA = 0.6;

export interface Candidato {
  id: number;
  concetti: Map<string, number>; // etichetta -> rank bm25 (negativo = migliore)
  pesi: number;
  rank: number;
  semantica: number;
  titolo: string;
  anno: string;
  cartella: string;
  nomeFile: string;
  tipo: string;
  inTitolo: boolean;
  punteggio: number;
}

/* -------------------------------------------------------------------------- */
/* Tipologia e peso della fonte                                                */
/* -------------------------------------------------------------------------- */

export function tipoFonte(cartella: string, titolo: string): string {
  const c = normalizza(cartella.replace(/^\s*\d+\s*-\s*/, ""));
  const t = normalizza(titolo);
  const regole: Array<[RegExp, string]> = [
    [/circolar/, "Circolare"], [/risoluzion/, "Risoluzione"], [/provvediment/, "Provvedimento"],
    [/decret/, "Decreto"], [/^legg/, "Legge"], [/^note$|^nota/, "Nota"], [/chiariment/, "Chiarimento"],
    [/sentenz/, "Sentenza"], [/istruzion/, "Istruzioni"], [/direttiv/, "Direttiva"], [/determinazion/, "Determinazione"],
    [/procedur/, "Procedura"], [/manual/, "Manuale"], [/linee guida/, "Linee guida"], [/massimar/, "Massimario"],
    [/guid/, "Guida"], [/comunicat/, "Comunicato"], [/convegn|slide/, "Convegno"], [/cors/, "Corso"],
    [/modulistic/, "Modulistica"], [/sanzion/, "Sanzioni"], [/demani/, "Demanio"],
  ];
  for (const [re, tipo] of regole) if (re.test(c)) return tipo;
  // "Sito Ade": la tipologia si ricava dal titolo quando possibile.
  for (const [re, tipo] of [[/^circ/, "Circolare"], [/^ris/, "Risoluzione"], [/^prov/, "Provvedimento"], [/^nota/, "Nota"]] as Array<[RegExp, string]>) {
    if (re.test(t)) return tipo;
  }
  return /sito ade/.test(c) ? "Scheda AdE" : "Altro";
}

/** Gerarchia/valore della fonte nel punteggio (legge > prassi > materiali). */
const PESO_TIPO: Record<string, number> = {
  Legge: 1, Decreto: 1, Circolare: 0.95, Provvedimento: 0.9, Risoluzione: 0.85, Nota: 0.8, Chiarimento: 0.8,
  Direttiva: 0.8, Sentenza: 0.75, Determinazione: 0.75, Istruzioni: 0.75, Massimario: 0.7, "Linee guida": 0.7,
  Procedura: 0.7, Sanzioni: 0.7, Manuale: 0.65, "Scheda AdE": 0.6, Guida: 0.55, Demanio: 0.5, Comunicato: 0.5,
  Corso: 0.45, Convegno: 0.4, Modulistica: 0.35, Altro: 0.5,
};

/* -------------------------------------------------------------------------- */
/* Utility                                                                     */
/* -------------------------------------------------------------------------- */

async function aLotti<T, R>(voci: T[], dimensione: number, fn: (lotto: T[]) => Promise<R[]>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < voci.length; i += dimensione) out.push(...(await fn(voci.slice(i, i + dimensione))));
  return out;
}

export async function inParallelo<T, R>(voci: T[], limite: number, fn: (v: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(voci.length);
  let prossimo = 0;
  const lavoratori = Array.from({ length: Math.min(limite, voci.length) }, async () => {
    while (prossimo < voci.length) {
      const i = prossimo++;
      out[i] = await fn(voci[i], i);
    }
  });
  await Promise.all(lavoratori);
  return out;
}

const placeholders = (n: number) => Array.from({ length: n }, () => "?").join(",");

/* -------------------------------------------------------------------------- */
/* Recupero lessicale                                                          */
/* -------------------------------------------------------------------------- */

export interface EsitoRecupero {
  candidati: Map<number, Candidato>;
  conteggi: Map<string, number>;
  scartatiCodice: number;
  avvisi: string[];
}

export async function cercaConcetti(db: Client, concetti: Concetto[]): Promise<EsitoRecupero> {
  const candidati = new Map<number, Candidato>();
  const conteggi = new Map<string, number>();
  const avvisi: string[] = [];
  let scartatiCodice = 0;

  const risultati = await inParallelo(concetti, 6, async (c) => {
    try {
      const rs = await db.execute({
        sql: `SELECT rowid AS id, bm25(documenti_fts, 1.0, 8.0, 4.0) AS rank
              FROM documenti_fts WHERE documenti_fts MATCH ? ORDER BY rank LIMIT ${MAX_PER_CONCETTO}`,
        args: [c.fts],
      });
      return rs.rows.map((r) => ({ id: Number(r.id), rank: Number(r.rank) }));
    } catch (err) {
      avvisi.push(`Concetto "${c.etichetta}" escluso (espressione non valida): ${(err as Error).message.slice(0, 80)}`);
      return [];
    }
  });

  // Codici di categoria: "f 3" intercetta anche "lettera f) 3." -> si tiene
  // il documento solo se nel testo originale compare la barra (F/3).
  for (let i = 0; i < concetti.length; i++) {
    const c = concetti[i];
    if (!c.codice || risultati[i].length === 0) continue;
    const [l, n] = c.codice.split("/");
    // FTS5 evidenzia la FRASE intera («F/3»), non i singoli token («F»/«3»):
    // la regex accetta entrambe le forme e richiede la barra tra i due.
    const re = new RegExp(`«\\s*${l}\\s*(?:»\\s*)?\\/\\s*(?:«\\s*)?0?${Number(n)}\\s*»`, "i");
    const ids = risultati[i].map((r) => r.id);
    const validi = new Set<number>();
    await aLotti(ids, 400, async (lotto) => {
      const rs = await db.execute({
        sql: `SELECT rowid AS id, snippet(documenti_fts, -1, '«', '»', '', 10) AS s
              FROM documenti_fts WHERE documenti_fts MATCH ? AND rowid IN (${placeholders(lotto.length)})`,
        args: [c.fts, ...lotto],
      });
      for (const r of rs.rows) if (re.test(String(r.s ?? ""))) validi.add(Number(r.id));
      return [];
    });
    scartatiCodice += ids.length - validi.size;
    risultati[i] = risultati[i].filter((r) => validi.has(r.id));
  }

  concetti.forEach((c, i) => {
    conteggi.set(c.etichetta, risultati[i].length);
    for (const { id, rank } of risultati[i]) {
      let cand = candidati.get(id);
      if (!cand) {
        cand = { id, concetti: new Map(), pesi: 0, rank: 0, semantica: 0, titolo: "", anno: "0000", cartella: "", nomeFile: "", tipo: "Altro", inTitolo: false, punteggio: 0 };
        candidati.set(id, cand);
      }
      if (!cand.concetti.has(c.etichetta)) {
        cand.concetti.set(c.etichetta, rank);
        cand.pesi += c.peso;
      }
      cand.rank = Math.min(cand.rank, rank * c.peso);
    }
  });
  return { candidati, conteggi, scartatiCodice, avvisi };
}

/** Quanti documenti contengono un'espressione (validazione dei termini proposti dal modello). */
export async function contaDocumenti(db: Client, fts: string): Promise<number> {
  try {
    const rs = await db.execute({ sql: `SELECT COUNT(*) AS n FROM documenti_fts WHERE documenti_fts MATCH ?`, args: [fts] });
    return Number(rs.rows[0]?.n ?? 0);
  } catch {
    return -1;
  }
}

/* -------------------------------------------------------------------------- */
/* Recupero semantico                                                          */
/* -------------------------------------------------------------------------- */

/** docId -> miglior punteggio coseno. Vuoto (mai errore) se Cloudflare non risponde. */
export async function cercaSemantica(testo: string): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!process.env.CF_ACCOUNT_ID || !process.env.CF_API_TOKEN || !process.env.CF_VECTORIZE_INDEX) return out;
  // Guardiano delle quote Vectorize: con l'indice oltre le dimensioni incluse
  // nel piano anche una query costerebbe; si resta sulla ricerca testuale.
  if (!(await prenotaQueryVectorize())) throw new Error("sospesa per restare nelle quote gratuite di Vectorize");
  const vettore = await embed(testo);
  const matches = await vectorSearchIds(vettore, 100);
  for (const m of matches) {
    const docId = Number(String(m.id).split("-")[0]);
    if (!Number.isFinite(docId)) continue;
    out.set(docId, Math.max(out.get(docId) ?? 0, m.score));
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Metadati, punteggio, selezione                                              */
/* -------------------------------------------------------------------------- */

export async function arricchisci(
  db: Client,
  candidati: Map<number, Candidato>,
  semantica: Map<number, number>,
  concetti: Concetto[]
): Promise<Candidato[]> {
  // Le fonti trovate SOLO dal canale semantico entrano se abbastanza simili.
  for (const [id, score] of semantica) {
    const c = candidati.get(id);
    if (c) c.semantica = score;
    else if (score >= SOGLIA_SEMANTICA) {
      candidati.set(id, { id, concetti: new Map(), pesi: 0, rank: 0, semantica: score, titolo: "", anno: "0000", cartella: "", nomeFile: "", tipo: "Altro", inTitolo: false, punteggio: 0 });
    }
  }

  const ids = [...candidati.keys()];
  await aLotti(ids, 400, async (lotto) => {
    const rs = await db.execute({
      sql: `SELECT id, cartella_origine AS cartella, nuovo_nome_file AS nomeFile, titolo, anno
            FROM documenti WHERE id IN (${placeholders(lotto.length)})`,
      args: lotto,
    });
    for (const r of rs.rows) {
      const c = candidati.get(Number(r.id));
      if (!c) continue;
      c.cartella = String(r.cartella ?? "");
      c.nomeFile = String(r.nomeFile ?? "");
      c.titolo = String(r.titolo ?? "") || c.nomeFile;
      c.anno = fmtAnno(r.anno);
      c.tipo = tipoFonte(c.cartella, c.titolo);
    }
    return [];
  });

  const forti = concetti.filter((c) => c.peso >= 0.8).map((c) => new RegExp(c.regex, "iu"));
  const lista = [...candidati.values()].filter((c) => c.cartella || c.titolo);
  for (const c of lista) c.inTitolo = forti.some((re) => re.test(c.titolo));

  // Normalizzazioni sul set corrente (il punteggio e' relativo all'argomento).
  const ranks = lista.filter((c) => c.concetti.size > 0).map((c) => c.rank);
  const migliore = Math.min(...ranks, 0);
  const peggiore = Math.max(...ranks, 0);
  const maxPesi = Math.max(...lista.map((c) => c.pesi), 1);

  for (const c of lista) {
    const peso = PESO_TIPO[c.tipo] ?? 0.5;
    const sem = c.semantica > 0 ? Math.min(1, Math.max(0, (c.semantica - 0.5) / 0.35)) : 0;
    if (c.concetti.size === 0) {
      c.punteggio = Math.round(100 * (0.35 * sem + 0.12 * peso));
      continue;
    }
    const bm = migliore === peggiore ? 1 : (peggiore - c.rank) / (peggiore - migliore);
    const copertura = c.pesi / maxPesi;
    c.punteggio = Math.round(100 * (0.4 * bm + 0.25 * copertura + 0.15 * (c.inTitolo ? 1 : 0) + 0.12 * peso + 0.08 * sem));
  }
  return lista.sort((a, b) => b.punteggio - a.punteggio || a.anno.localeCompare(b.anno));
}

/**
 * Quali fonti analizzare in dettaglio. Oltre alle piu' rilevanti, entrano per
 * garanzia (anti-omissione): le fonti col tema nel titolo, leggi e decreti
 * pertinenti, le piu' antiche (origini dell'istituto) e le piu' recenti
 * (disciplina vigente). Il resto resta "menzione" nell'indice.
 */
export function selezionaAnalizzate(ordinati: Candidato[]): Set<number> {
  const n = ordinati.length;
  if (n <= 12) return new Set(ordinati.map((c) => c.id));
  const quota = Math.min(MAX_ANALIZZATE, Math.max(12, Math.round(n * 0.3)));
  const priorita = new Map<number, number>();
  const metti = (c: Candidato, bonus: number) => priorita.set(c.id, Math.max(priorita.get(c.id) ?? 0, c.punteggio + bonus));

  ordinati.slice(0, quota).forEach((c) => metti(c, 0));
  const rilevanti = ordinati.filter((c) => c.punteggio >= 25 && c.concetti.size > 0);
  rilevanti.filter((c) => c.inTitolo).forEach((c) => metti(c, 25));
  rilevanti.filter((c) => (c.tipo === "Legge" || c.tipo === "Decreto") && c.punteggio >= 35).forEach((c) => metti(c, 20));
  const datati = rilevanti.filter((c) => c.anno !== "0000").sort((a, b) => a.anno.localeCompare(b.anno));
  datati.slice(0, 4).forEach((c) => metti(c, 30)); // origini
  datati.slice(-6).forEach((c) => metti(c, 30)); // disciplina recente

  // Atti quasi identici (stesso anno, titolo simile all'80%: ristampe,
  // allegati, versioni) si analizzano una volta sola; gli altri restano
  // nell'indice come menzioni. Meno lotti, meno neuroni, stesso contenuto.
  const perId = new Map(ordinati.map((c) => [c.id, c]));
  const scelti: Candidato[] = [];
  for (const [id] of [...priorita.entries()].sort((a, b) => b[1] - a[1])) {
    if (scelti.length >= MAX_ANALIZZATE) break;
    const c = perId.get(id);
    if (!c) continue;
    if (scelti.some((s) => quasiUguali(s, c))) continue;
    scelti.push(c);
  }
  return new Set(scelti.map((c) => c.id));
}

const paroleTitolo = (t: string) => new Set(normalizza(t).split(/[^a-z0-9]+/).filter((p) => p.length > 2 && !/^(del|della|delle|dei|per|con|nel|nella)$/.test(p)));

/** Stesso anno e titoli con almeno l'80% di parole in comune (Jaccard). */
export function quasiUguali(a: { anno: string; titolo: string }, b: { anno: string; titolo: string }): boolean {
  if (a.anno !== b.anno) return false;
  const x = paroleTitolo(a.titolo);
  const y = paroleTitolo(b.titolo);
  if (x.size < 3 || y.size < 3) return false;
  let comuni = 0;
  for (const p of x) if (y.has(p)) comuni++;
  return comuni / (x.size + y.size - comuni) >= 0.8;
}

/* -------------------------------------------------------------------------- */
/* Estratti                                                                    */
/* -------------------------------------------------------------------------- */

const pulisci = (s: string) => s.replace(/\s+/g, " ").trim();

export interface Estratti {
  incipit: string;
  passaggi: string[];
  occorrenze: number;
}

/**
 * Estratti pertinenti dal testo integrale: finestre attorno alle occorrenze
 * dei concetti, unite se vicine, scelte per varieta' di concetti e numero di
 * occorrenze, restituite nell'ordine del documento.
 */
export function estraiDaTesto(testo: string, regex: RegExp[], max = 3, larghezza = 900): Estratti {
  const incipit = pulisci(testo.slice(0, 700)).slice(0, 520);
  const colpi: Array<{ pos: number; fine: number; c: number }> = [];
  regex.forEach((re, c) => {
    const g = new RegExp(re.source, "giu");
    let m: RegExpExecArray | null;
    let k = 0;
    while ((m = g.exec(testo)) && k++ < 250) {
      colpi.push({ pos: m.index, fine: m.index + m[0].length, c });
      if (m[0].length === 0) g.lastIndex++;
    }
  });
  if (colpi.length === 0) return { incipit, passaggi: [], occorrenze: 0 };
  colpi.sort((a, b) => a.pos - b.pos);

  const meta = Math.floor(larghezza / 2.4);
  const finestre: Array<{ da: number; a: number; concetti: Set<number>; colpi: number }> = [];
  for (const k of colpi) {
    const da = Math.max(0, k.pos - meta);
    const a = Math.min(testo.length, k.fine + (larghezza - meta));
    const ultima = finestre[finestre.length - 1];
    if (ultima && da <= ultima.a && a - ultima.da <= larghezza * 1.25) {
      ultima.a = Math.max(ultima.a, a);
      ultima.concetti.add(k.c);
      ultima.colpi++;
    } else finestre.push({ da, a, concetti: new Set([k.c]), colpi: 1 });
  }
  const scelte = finestre
    .map((f, i) => ({ ...f, i, punti: f.concetti.size * 3 + Math.min(f.colpi, 6) }))
    .sort((x, y) => y.punti - x.punti || x.i - y.i)
    .slice(0, max)
    .sort((x, y) => x.da - y.da);

  const passaggi = scelte.map((f) => {
    // Bordi su uno spazio: niente parole tagliate a meta'.
    let da = f.da;
    let a = f.a;
    if (da > 0) {
      const s = testo.indexOf(" ", da);
      da = s >= 0 && s - da < 40 ? s + 1 : da;
    }
    if (a < testo.length) {
      const s = testo.lastIndexOf(" ", a);
      a = s > da && a - s < 40 ? s : a;
    }
    return `${da > 0 ? "… " : ""}${pulisci(testo.slice(da, a))}${a < testo.length ? " …" : ""}`;
  });
  return { incipit, passaggi, occorrenze: colpi.length };
}

export async function estrattiAnalizzate(
  db: Client,
  ids: number[],
  concetti: Concetto[]
): Promise<Map<number, Estratti>> {
  const regex = concetti.map((c) => new RegExp(c.regex, "giu"));
  const out = new Map<number, Estratti>();
  const lotti: number[][] = [];
  for (let i = 0; i < ids.length; i += 8) lotti.push(ids.slice(i, i + 8));
  await inParallelo(lotti, 3, async (lotto) => {
    const rs = await db.execute({
      sql: `SELECT id, substr(testo_estratto, 1, 160000) AS testo FROM documenti WHERE id IN (${placeholders(lotto.length)})`,
      args: lotto,
    });
    for (const r of rs.rows) out.set(Number(r.id), estraiDaTesto(String(r.testo ?? ""), regex));
  });
  return out;
}

/** Estratto breve per le menzioni (snippet FTS; incipit per le sole semantiche). */
export async function estrattiMenzioni(db: Client, ids: number[], ftsUnione: string): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  await aLotti(ids, 300, async (lotto) => {
    try {
      const rs = await db.execute({
        sql: `SELECT rowid AS id, snippet(documenti_fts, 0, '', '', ' … ', 42) AS s
              FROM documenti_fts WHERE documenti_fts MATCH ? AND rowid IN (${placeholders(lotto.length)})`,
        args: [ftsUnione, ...lotto],
      });
      for (const r of rs.rows) out.set(Number(r.id), pulisci(String(r.s ?? "")));
    } catch {
      /* espressione troppo lunga o non valida: si ripiega sull'incipit */
    }
    return [];
  });
  const senza = ids.filter((id) => !out.get(id));
  await aLotti(senza, 300, async (lotto) => {
    const rs = await db.execute({
      sql: `SELECT id, substr(testo_estratto, 1, 340) AS s FROM documenti WHERE id IN (${placeholders(lotto.length)})`,
      args: lotto,
    });
    for (const r of rs.rows) out.set(Number(r.id), `${pulisci(String(r.s ?? ""))} …`);
    return [];
  });
  return out;
}

export async function versioneCorpus(db: Client): Promise<{ documenti: number; maxId: number }> {
  const rs = await db.execute(`SELECT COUNT(*) AS n, MAX(id) AS m FROM documenti`);
  return { documenti: Number(rs.rows[0]?.n ?? 0), maxId: Number(rs.rows[0]?.m ?? 0) };
}

/** Fonti pertinenti entrate nel corpus dopo la generazione di un dossier. */
export async function nuoveFontiDopo(db: Client, ftsUnione: string, maxId: number): Promise<number> {
  try {
    const rs = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM documenti_fts WHERE documenti_fts MATCH ? AND rowid > ?`,
      args: [ftsUnione, maxId],
    });
    return Number(rs.rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}

export { docUrl };
