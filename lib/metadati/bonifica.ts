import { createHash } from "node:crypto";
import type { Client, InStatement } from "@libsql/client";
import { dataLeggibile, normalizzaMetadati, REVISIONE_REGOLE, TIPO_STUDIO, type DocMeta, type Proposta } from "./normalizza";

/**
 * Bonifica dei metadati del corpus: idempotente e rieseguibile.
 *
 *   - tipologia, numero, data ed estremi normalizzati -> tabella
 *     `documenti_meta` (separata: nessuna reindicizzazione FTS, e sopravvive a
 *     una reimportazione di `documenti` dalla pipeline locale);
 *   - duplicati esatti (stesso testo) -> `documenti_meta.duplicato_di`;
 *   - correzioni di `documenti.anno` e dei titoli inservibili solo con regole
 *     ad alta confidenza; ogni modifica e' registrata in `metadati_bonifica`
 *     con il valore precedente (reversibile);
 *   - i casi ambigui finiscono nel rapporto "da revisionare", senza modifiche.
 *
 * Usata dallo script `scripts/bonifica-metadati.ts`, dall'endpoint di
 * manutenzione e dal cron del lunedi' (solo i documenti nuovi).
 */

const DDL = [
  `CREATE TABLE IF NOT EXISTS documenti_meta (
     doc_id INTEGER PRIMARY KEY,
     tipo_atto TEXT,
     numero_atto TEXT,
     data_atto TEXT,
     estremi TEXT,
     duplicato_di INTEGER,
     revisione INTEGER NOT NULL,
     aggiornato_il TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_documenti_meta_dup ON documenti_meta(duplicato_di)`,
  `CREATE TABLE IF NOT EXISTS metadati_bonifica (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     esecuzione INTEGER,
     doc_id INTEGER NOT NULL,
     campo TEXT NOT NULL,
     prima TEXT,
     dopo TEXT,
     motivo TEXT,
     confidenza TEXT,
     applicato INTEGER NOT NULL,
     creato_il TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_metadati_bonifica_doc ON metadati_bonifica(doc_id)`,
  `CREATE TABLE IF NOT EXISTS metadati_esecuzioni (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     avviata_il TEXT NOT NULL,
     conclusa_il TEXT,
     applica INTEGER NOT NULL,
     ambito TEXT,
     esaminati INTEGER,
     modificati INTEGER,
     rapporto TEXT
   )`,
];

export async function assicuraSchemaMetadati(db: Client): Promise<void> {
  await db.batch(DDL, "write");
}

/* -------------------------------------------------------------------------- */
/* Lettura per i consumatori (ricerca, Studio, Normie)                         */
/* -------------------------------------------------------------------------- */

let metaEsiste: { il: number; si: boolean } | null = null;

/** La tabella dei metadati normalizzati esiste? (cache 5 minuti per istanza) */
export async function haMetadati(db: Client): Promise<boolean> {
  if (metaEsiste && Date.now() - metaEsiste.il < 5 * 60_000) return metaEsiste.si;
  try {
    const rs = await db.execute(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'documenti_meta'`);
    metaEsiste = { il: Date.now(), si: rs.rows.length > 0 };
  } catch {
    metaEsiste = { il: Date.now(), si: false };
  }
  return metaEsiste.si;
}

export function _azzeraCacheMetadati(): void {
  metaEsiste = null;
}

/* -------------------------------------------------------------------------- */
/* Esecuzione                                                                  */
/* -------------------------------------------------------------------------- */

export interface Modifica {
  id: number;
  campo: "anno" | "titolo";
  prima: string;
  dopo: string;
  motivo: string;
  confidenza: string;
}

export interface RapportoBonifica {
  esecuzione: number | null;
  applica: boolean;
  esaminati: number;
  conMetadati: number;
  modificati: number;
  anni: number;
  anniMancantiRecuperati: number;
  titoli: number;
  tipologie: Record<string, number>;
  tipologieDaTesto: number;
  conEstremi: number;
  conData: number;
  duplicati: number;
  daRevisionare: number;
  /** Documenti con ambiguita' sciolte dalle regole v2 (con o senza modifica). */
  risolti: number;
  modifiche: Modifica[];
  revisione: Array<{ id: number; titolo: string; cartella: string; anno: number; motivi: string[] }>;
  risoluzioni: Array<{ id: number; titolo: string; cartella: string; anno: number; motivi: string[] }>;
  /** Campione di duplicati esatti (copia -> canonico) per la verifica. */
  esempiDuplicati: Array<{ id: number; titolo: string; di: number }>;
  durataMs: number;
  completata: boolean;
  ultimoId: number;
}

interface Riga {
  id: number;
  cartella: string;
  nomeFile: string;
  titolo: string;
  anno: number;
  inizio: string;
  fine: string;
  impronta: string | null;
}

const LOTTO = 150;

/** Impronta del testo per i duplicati esatti (lunghezza + inizio + fine). */
function impronta(lunghezza: number, testa: string, coda: string): string | null {
  if (lunghezza < 800) return null;
  return createHash("sha1").update(`${lunghezza}|${testa}|${coda}`).digest("hex");
}

export interface OpzioniBonifica {
  applica: boolean;
  /** Solo questi documenti (es. i nuovi del cron). */
  ids?: number[];
  /** Riprende dopo questo id (esecuzioni a tappe). */
  daId?: number;
  /** Tempo massimo prima di fermarsi e restituire un rapporto parziale. */
  budgetMs?: number;
  /** Per i documenti nuovi: metadati gia' noti dal cron (prevalgono). */
  noti?: Map<number, { tipo?: string; numero?: string | null; data?: string | null }>;
}

export async function eseguiBonifica(db: Client, opz: OpzioniBonifica): Promise<RapportoBonifica> {
  const t0 = Date.now();
  await assicuraSchemaMetadati(db);
  metaEsiste = null;
  const budgetMs = opz.budgetMs ?? 240_000;
  const r: RapportoBonifica = {
    esecuzione: null,
    applica: opz.applica,
    esaminati: 0,
    conMetadati: 0,
    modificati: 0,
    anni: 0,
    anniMancantiRecuperati: 0,
    titoli: 0,
    tipologie: {},
    tipologieDaTesto: 0,
    conEstremi: 0,
    conData: 0,
    duplicati: 0,
    daRevisionare: 0,
    risolti: 0,
    modifiche: [],
    revisione: [],
    risoluzioni: [],
    esempiDuplicati: [],
    durataMs: 0,
    completata: false,
    ultimoId: opz.daId ?? 0,
  };
  const adesso = () => new Date().toISOString();
  const ins = await db.execute({
    sql: `INSERT INTO metadati_esecuzioni (avviata_il, applica, ambito) VALUES (?, ?, ?) RETURNING id`,
    args: [adesso(), opz.applica ? 1 : 0, opz.ids ? `documenti ${opz.ids.length}` : opz.daId ? `da id ${opz.daId}` : "corpus"],
  });
  r.esecuzione = Number(ins.rows[0]?.id ?? 0) || null;

  // Impronte gia' note (per riconoscere i duplicati anche fra lotti diversi).
  const primiPerImpronta = new Map<string, { id: number; copia: boolean }>();
  const leggi = async (dopo: number): Promise<Riga[]> => {
    const filtro = opz.ids?.length ? `AND id IN (${opz.ids.map(() => "?").join(",")})` : "";
    const rs = await db.execute({
      sql: `SELECT id, cartella_origine AS cartella, nuovo_nome_file AS nome, titolo, anno,
                   substr(testo_estratto, 1, 2500) AS inizio, length(testo_estratto) AS lunghezza,
                   substr(testo_estratto, 1, 2000) AS testa, substr(testo_estratto, -2000) AS coda
            FROM documenti WHERE id > ? ${filtro} ORDER BY id LIMIT ?`,
      args: [dopo, ...(opz.ids ?? []), LOTTO],
    });
    return rs.rows.map((x) => ({
      id: Number(x.id),
      cartella: String(x.cartella ?? ""),
      nomeFile: String(x.nome ?? ""),
      titolo: String(x.titolo ?? ""),
      anno: Number(x.anno ?? 0) || 0,
      inizio: String(x.inizio ?? ""),
      fine: String(x.coda ?? ""),
      impronta: impronta(Number(x.lunghezza ?? 0), String(x.testa ?? ""), String(x.coda ?? "")),
    }));
  };

  // Per i duplicati servono le impronte dei documenti fuori da questa tappa
  // (nuovi atti del cron o ripresa da un id).
  if (opz.ids?.length || opz.daId) {
    const esclusi = new Set(opz.ids ?? []);
    const rs = await db.execute({
      sql: `SELECT id, nuovo_nome_file AS nome, length(testo_estratto) AS lunghezza, substr(testo_estratto, 1, 2000) AS testa, substr(testo_estratto, -2000) AS coda
            FROM documenti WHERE id <= ? ORDER BY id`,
      args: [opz.ids?.length ? Number.MAX_SAFE_INTEGER : opz.daId ?? 0],
    });
    for (const x of rs.rows) {
      const id = Number(x.id);
      if (esclusi.has(id)) continue;
      const imp = impronta(Number(x.lunghezza ?? 0), String(x.testa ?? ""), String(x.coda ?? ""));
      if (!imp) continue;
      const copia = /\(\d+\)\.pdf$/i.test(String(x.nome ?? ""));
      const primo = primiPerImpronta.get(imp);
      if (!primo || (primo.copia && !copia)) primiPerImpronta.set(imp, { id, copia });
    }
  }

  // Fase 1: lettura e proposte per tutti i documenti dell'ambito.
  interface Elaborato {
    d: Riga;
    p: Proposta;
    tipoAtto: string;
    numero: string | null;
    data: string | null;
    estremi: string | null;
    duplicatoDi: number | null;
  }
  const elaborati: Elaborato[] = [];
  const correzioniCanonico: Array<{ copia: number; canonico: number }> = [];
  let dopo = opz.daId ?? 0;
  for (;;) {
    if (Date.now() - t0 > budgetMs) break;
    const righe = await leggi(dopo);
    if (!righe.length) {
      r.completata = true;
      break;
    }
    for (const d of righe) {
      dopo = d.id;
      const p: Proposta = normalizzaMetadati({ id: d.id, cartella: d.cartella, nomeFile: d.nomeFile, titolo: d.titolo, anno: d.anno, testo: d.inizio, fine: d.fine } satisfies DocMeta);
      const noto = opz.noti?.get(d.id);
      const tipoAtto = noto?.tipo && TIPO_STUDIO[noto.tipo] ? noto.tipo : p.tipoAtto;
      const numero = noto?.numero ?? p.numero;
      const data = noto?.data ?? p.data;
      const estremi = noto ? (numero || data ? `${tipoAtto}${numero ? ` n. ${numero}` : ""}${data ? ` del ${dataLeggibile(data)}` : ""}` : null) : p.estremi;
      // Duplicati esatti: il canonico e' il primo senza suffisso "(n)".
      let duplicatoDi: number | null = null;
      if (d.impronta) {
        const primo = primiPerImpronta.get(d.impronta);
        const copia = /\(\d+\)\.pdf$/i.test(d.nomeFile);
        if (!primo) primiPerImpronta.set(d.impronta, { id: d.id, copia });
        else if (primo.copia && !copia) {
          correzioniCanonico.push({ copia: primo.id, canonico: d.id });
          primiPerImpronta.set(d.impronta, { id: d.id, copia });
        } else duplicatoDi = primo.id;
      }
      elaborati.push({ d, p, tipoAtto, numero, data, estremi, duplicatoDi });
    }
    r.ultimoId = dopo;
  }

  // Fase 2: la stessa intestazione proposta per 3 o piu' documenti diversi e'
  // quasi sempre un atto CITATO (preambolo, raccolta): niente correzione.
  const firme = new Map<string, number>();
  const firma = (e: Elaborato) => `${e.tipoAtto}|${e.numero ?? ""}|${e.data ?? ""}`;
  for (const e of elaborati) if (e.p.anno?.motivo.startsWith("intestazione") && !e.duplicatoDi) firme.set(firma(e), (firme.get(firma(e)) ?? 0) + 1);
  for (const e of elaborati) {
    if (!e.p.anno?.motivo.startsWith("intestazione")) continue;
    const n = firme.get(firma(e)) ?? 0;
    const numeroNelTitolo = !!e.numero && new RegExp(`(?<!\\d)${e.numero.split("/")[0]}(?!\\d)`).test(`${e.d.titolo} ${e.d.nomeFile}`);
    if (n >= 3 && !numeroNelTitolo) {
      e.p.revisione.push(`la stessa intestazione (${e.estremi ?? e.tipoAtto}) compare in ${n} documenti: probabile atto citato, anno non corretto`);
      e.p.anno = null;
    }
  }

  // Fase 3: rapporto e scritture.
  const istruzioni: InStatement[] = [];
  for (const { d, p, tipoAtto, numero, data, estremi, duplicatoDi } of elaborati) {
    r.esaminati++;
    if (duplicatoDi) {
      r.duplicati++;
      if (r.esempiDuplicati.length < 60) r.esempiDuplicati.push({ id: d.id, titolo: d.titolo, di: duplicatoDi });
    }
    r.tipologie[tipoAtto] = (r.tipologie[tipoAtto] ?? 0) + 1;
    if (p.origineTipo === "testo") r.tipologieDaTesto++;
    if (estremi) r.conEstremi++;
    if (data) r.conData++;
    r.conMetadati++;
    istruzioni.push({
      sql: `INSERT INTO documenti_meta (doc_id, tipo_atto, numero_atto, data_atto, estremi, duplicato_di, revisione, aggiornato_il)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(doc_id) DO UPDATE SET tipo_atto = excluded.tipo_atto, numero_atto = excluded.numero_atto,
              data_atto = excluded.data_atto, estremi = excluded.estremi, duplicato_di = excluded.duplicato_di,
              revisione = excluded.revisione, aggiornato_il = excluded.aggiornato_il`,
      args: [d.id, tipoAtto, numero, data, estremi, duplicatoDi, REVISIONE_REGOLE, adesso()],
    });
    const set: string[] = [];
    const args: Array<string | number> = [];
    const mie: Modifica[] = [];
    if (p.anno && (p.anno.confidenza === "alta" || p.anno.confidenza === "media")) {
      set.push("anno = ?");
      args.push(p.anno.valore);
      r.anni++;
      if (!d.anno) r.anniMancantiRecuperati++;
      mie.push({ id: d.id, campo: "anno", prima: String(d.anno || "s.d."), dopo: String(p.anno.valore), motivo: p.anno.motivo, confidenza: p.anno.confidenza });
    }
    if (p.titolo) {
      set.push("titolo = ?");
      args.push(p.titolo.valore);
      r.titoli++;
      mie.push({ id: d.id, campo: "titolo", prima: d.titolo, dopo: p.titolo.valore, motivo: p.titolo.motivo, confidenza: "media" });
    }
    if (set.length) {
      r.modificati++;
      r.modifiche.push(...mie);
      istruzioni.push({ sql: `UPDATE documenti SET ${set.join(", ")} WHERE id = ?`, args: [...args, d.id] });
      for (const m of mie) {
        istruzioni.push({
          sql: `INSERT INTO metadati_bonifica (esecuzione, doc_id, campo, prima, dopo, motivo, confidenza, applicato, creato_il) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [r.esecuzione, d.id, m.campo, m.prima, m.dopo, m.motivo, m.confidenza, opz.applica ? 1 : 0, adesso()],
        });
      }
    }
    if (p.revisione.length) {
      r.daRevisionare++;
      r.revisione.push({ id: d.id, titolo: d.titolo, cartella: d.cartella, anno: d.anno, motivi: p.revisione });
    }
    if (p.risolti.length) {
      r.risolti++;
      r.risoluzioni.push({ id: d.id, titolo: d.titolo, cartella: d.cartella, anno: d.anno, motivi: p.risolti });
    }
  }
  for (const c of correzioniCanonico) {
    istruzioni.push({ sql: `UPDATE documenti_meta SET duplicato_di = ? WHERE doc_id = ?`, args: [c.canonico, c.copia] });
    r.duplicati++;
  }
  if (opz.applica && istruzioni.length) {
    for (let i = 0; i < istruzioni.length; i += 60) await db.batch(istruzioni.slice(i, i + 60), "write");
  }

  r.durataMs = Date.now() - t0;
  const sintesi = { ...r, modifiche: r.modifiche.slice(0, 400), revisione: r.revisione.slice(0, 400) };
  await db
    .execute({
      sql: `UPDATE metadati_esecuzioni SET conclusa_il = ?, esaminati = ?, modificati = ?, rapporto = ? WHERE id = ?`,
      args: [adesso(), r.esaminati, r.modificati, JSON.stringify(sintesi), r.esecuzione],
    })
    .catch(() => undefined);
  return r;
}

/** Ultime esecuzioni della bonifica (per la pagina di stato). */
export async function ultimeBonifiche(db: Client, limite = 5): Promise<Array<{ id: number; avviataIl: string; applica: boolean; ambito: string; esaminati: number; modificati: number }>> {
  try {
    const rs = await db.execute({
      sql: `SELECT id, avviata_il, applica, ambito, esaminati, modificati FROM metadati_esecuzioni ORDER BY id DESC LIMIT ?`,
      args: [limite],
    });
    return rs.rows.map((x) => ({
      id: Number(x.id),
      avviataIl: String(x.avviata_il),
      applica: Number(x.applica) === 1,
      ambito: String(x.ambito ?? ""),
      esaminati: Number(x.esaminati ?? 0),
      modificati: Number(x.modificati ?? 0),
    }));
  } catch {
    return [];
  }
}

export interface StatoMetadati {
  documenti: number;
  normalizzati: number;
  duplicati: number;
  conEstremi: number;
  correzioni: number;
  ultima: { avviataIl: string; applica: boolean; esaminati: number; modificati: number } | null;
}

/** Riepilogo della qualita' dei metadati per la pagina di stato. */
export async function statoMetadati(db: Client): Promise<StatoMetadati | null> {
  if (!(await haMetadati(db))) return null;
  try {
    const [a, b, c] = await db.batch(
      [
        `SELECT (SELECT COUNT(*) FROM documenti) AS documenti, COUNT(*) AS normalizzati,
                SUM(CASE WHEN duplicato_di IS NOT NULL THEN 1 ELSE 0 END) AS duplicati,
                SUM(CASE WHEN estremi IS NOT NULL THEN 1 ELSE 0 END) AS estremi
         FROM documenti_meta`,
        `SELECT COUNT(*) AS n FROM metadati_bonifica WHERE applicato = 1`,
        `SELECT avviata_il, applica, esaminati, modificati FROM metadati_esecuzioni WHERE conclusa_il IS NOT NULL AND applica = 1 ORDER BY id DESC LIMIT 1`,
      ],
      "read"
    );
    const r = a.rows[0];
    const u = c.rows[0];
    return {
      documenti: Number(r?.documenti ?? 0),
      normalizzati: Number(r?.normalizzati ?? 0),
      duplicati: Number(r?.duplicati ?? 0),
      conEstremi: Number(r?.estremi ?? 0),
      correzioni: Number(b.rows[0]?.n ?? 0),
      ultima: u ? { avviataIl: String(u.avviata_il), applica: Number(u.applica) === 1, esaminati: Number(u.esaminati ?? 0), modificati: Number(u.modificati ?? 0) } : null,
    };
  } catch {
    return null;
  }
}
