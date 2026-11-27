import { createHash } from "node:crypto";
import type { Client } from "@libsql/client";
import { decodificaEntita, parseData, USER_AGENT } from "./fonti";
import { valutaMetadati, valutaTesto } from "./pertinenza";
import { assicuraSchema, cercaDuplicato, inserisciDocumento, registraVoce, vociNote } from "./archivio";
import { chiaveAtto, oggettoDiRipiego } from "./esegui";
import type { ControlloQuotidiano } from "./tipi";

/**
 * Gazzetta Ufficiale, Serie Generale (verificato il 27/11/2026 dalla rete
 * Vercel): feed RSS 2.0 ufficiale https://www.gazzettaufficiale.it/rss/SG con
 * il sommario dell'ULTIMO numero (~20-30 atti). Ogni voce:
 *
 *   <title>MINISTERO DELL'ECONOMIA E DELLE FINANZE - DECRETO 13 novembre 2026</title>
 *   <link>http://www.gazzettaufficiale.it/eli/id/2026/11/26/26A06163/SG</link>
 *   <content:encoded>Autorizzazione alla riscossione ... (26A06163)</content:encoded>
 *
 * Il testo dell'atto e' HTML (nessun PDF): /atto/serie_generale/
 * caricaArticoloDefault/originario?atto.dataPubblicazioneGazzetta=...&
 * atto.codiceRedazionale=... (lo stesso iframe della pagina ELI).
 *
 * La Gazzetta esce ogni giorno: il feed si legge dal cron GIORNALIERO, che
 * importa solo gli atti con parole catastali nel titolo o nell'oggetto (filtro
 * rigoroso, poi la stessa verifica sul testo degli atti dell'Agenzia).
 * Nessun modello AI: titolo dall'oggetto ufficiale.
 *
 * Normattiva e' stata valutata e scartata: il portale open data
 * (dati.normattiva.it) usa un'API interna per la propria interfaccia
 * (api.normattiva.it/.../bff-opendata), con download su richiesta e verifica
 * via email: non adatta a un controllo automatico affidabile.
 */

export const FEED_GU = "https://www.gazzettaufficiale.it/rss/SG";
const BASE_GU = "https://www.gazzettaufficiale.it";
export const FONTE_GU = "gu-serie-generale";

export interface AttoGazzetta {
  titolo: string;
  /** Link ELI dell'atto (https), chiave di deduplica. */
  link: string;
  oggetto: string;
  codice: string;
  /** Data di pubblicazione in Gazzetta (AAAA-MM-GG). */
  pubblicazione: string;
  /** Tipologia normalizzata ("Decreto", "Legge", "D.P.R."...). */
  tipo: string;
  emittente: string | null;
  /** Data dell'atto (AAAA-MM-GG) dal titolo. */
  data: string | null;
  numero: string | null;
}

const tag = (s: string, nome: string) => {
  const m = s.match(new RegExp(`<${nome}[^>]*>([\\s\\S]*?)</${nome}>`, "i"));
  return m ? m[1].replace(/^<!\[CDATA\[|\]\]>$/g, "") : "";
};
const pulisci = (s: string) => decodificaEntita(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

const TIPI: Array<[RegExp, string]> = [
  [/^DECRETO[\s-]+LEGGE\b/i, "Decreto-legge"],
  [/^DECRETO\s+LEGISLATIVO\b/i, "Decreto legislativo"],
  [/^DECRETO\s+DEL\s+PRESIDENTE\s+DELLA\s+REPUBBLICA\b/i, "D.P.R."],
  [/^DECRETO\s+DEL\s+PRESIDENTE\s+DEL\s+CONSIGLIO\b/i, "D.P.C.M."],
  [/^LEGGE\b/i, "Legge"],
  [/^DECRETO\b/i, "Decreto"],
  [/^PROVVEDIMENTO\b/i, "Provvedimento"],
  [/^DETERMINA(?:ZIONE)?\b/i, "Determinazione"],
  [/^DELIBERA(?:ZIONE)?\b/i, "Delibera"],
  [/^CIRCOLARE\b/i, "Circolare"],
  [/^ORDINANZA\b/i, "Ordinanza"],
  [/^COMUNICATO\b/i, "Comunicato"],
];

/** "MINISTERO ... - DECRETO 13 novembre 2026" -> emittente, tipo, data, numero. */
export function analizzaTitolo(titolo: string): Pick<AttoGazzetta, "tipo" | "emittente" | "data" | "numero"> {
  const t = titolo.replace(/\s+/g, " ").trim();
  const parti = t.split(/\s+-\s+/);
  const atto = parti.length > 1 ? parti[parti.length - 1] : t;
  const emittente = parti.length > 1 ? parti.slice(0, -1).join(" - ") : null;
  const tipo = TIPI.find(([re]) => re.test(atto))?.[1] ?? "Atto";
  const numero = atto.match(/,\s*n\.?\s*(\d+)/i)?.[1] ?? null;
  return { tipo, emittente, data: parseData(atto), numero };
}

export function parseRssGazzetta(xml: string): AttoGazzetta[] {
  const out: AttoGazzetta[] = [];
  for (const grezzo of xml.split(/<item>/i).slice(1)) {
    const item = grezzo.split(/<\/item>/i)[0];
    const titolo = pulisci(tag(item, "title"));
    const link = tag(item, "link").trim().replace(/^http:\/\//i, "https://");
    const m = link.match(/\/eli\/id\/(\d{4})\/(\d{2})\/(\d{2})\/([A-Z0-9]+)\//i);
    if (!titolo || !m) continue;
    const oggetto = pulisci(tag(item, "content:encoded") || tag(item, "description")).replace(/\s*\([0-9]{2}[A-Z][0-9]{5}\)\s*$/, "");
    out.push({ titolo, link, oggetto, codice: m[4], pubblicazione: `${m[1]}-${m[2]}-${m[3]}`, ...analizzaTitolo(titolo) });
  }
  return out;
}

/**
 * Filtro rigoroso: solo atti con termini catastali o di pubblicita'
 * immobiliare nel titolo o nell'oggetto (niente rumore: la Gazzetta pubblica
 * ogni giorno decine di atti estranei). Esclusi i falsi amici: "rischi
 * catastrofali" e le volture dei contratti di energia (le volture contano
 * solo negli atti dell'Agenzia delle Entrate).
 */
const PERTINENZA_GU =
  /\bcatast(?!rof)|\bcensuar|agenzia\s+delle\s+entrate\b[\s\S]*\bvoltur|\bdocfa\b|\bpregeo\b|\brendit[ae]\s+catastal|conservatori[ae]\s+dei\s+registri\s+immobiliari|pubblicit[aà]\s+immobiliare|accatastament|\bmapp[ae]\s+catastal|tributi\s+speciali\s+catastali|fabbricati\s+rurali|osservatorio\s+del\s+mercato\s+immobiliare|unit[aà]\s+immobiliar[ei]\s+urban|\bestim[oi]\b/i;
export const pertinenteGazzetta = (a: Pick<AttoGazzetta, "titolo" | "oggetto">) => PERTINENZA_GU.test(`${a.titolo} ${a.oggetto}`);

export const urlTestoGazzetta = (a: Pick<AttoGazzetta, "pubblicazione" | "codice">) =>
  `${BASE_GU}/atto/serie_generale/caricaArticoloDefault/originario?atto.dataPubblicazioneGazzetta=${a.pubblicazione}&atto.codiceRedazionale=${a.codice}`;

/** Testo dell'atto dall'HTML della Gazzetta (paragrafi e a capo conservati). */
export function testoDaHtmlGazzetta(html: string): string {
  const corpo = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<head[\s\S]*?<\/head>/gi, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h\d|tr|pre)>/gi, "\n");
  return decodificaEntita(corpo.replace(/<[^>]+>/g, " "))
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const CARTELLE: Record<string, { cartella: string; abbrev: string; chiave: string }> = {
  Legge: { cartella: "12 - Leggi", abbrev: "L.", chiave: "legge" },
  "Decreto-legge": { cartella: "06 - Decreti Legge", abbrev: "DL", chiave: "decreto-legge" },
  "Decreto legislativo": { cartella: "06 - Decreti Legge", abbrev: "D.Lgs.", chiave: "decreto-legislativo" },
  "D.P.R.": { cartella: "06 - Decreti Legge", abbrev: "DPR", chiave: "dpr" },
  "D.P.C.M.": { cartella: "06 - Decreti Legge", abbrev: "DPCM", chiave: "dpcm" },
  Decreto: { cartella: "06 - Decreti Legge", abbrev: "Decr.", chiave: "decreto" },
  Provvedimento: { cartella: "19 - Provvedimenti", abbrev: "Prov.", chiave: "provvedimento" },
  Determinazione: { cartella: "08 - Determinazioni", abbrev: "Det.", chiave: "determinazione" },
  Circolare: { cartella: "02 - Circolari", abbrev: "Circ.", chiave: "circolare" },
  Comunicato: { cartella: "03 - Comunicati stampa", abbrev: "Com.", chiave: "comunicato" },
};
const ALTRO = { cartella: "06 - Decreti Legge", abbrev: "Atto", chiave: "atto-gu" };
export const destinazioneGazzetta = (tipo: string) => CARTELLE[tipo] ?? ALTRO;

export interface EsitoGazzetta {
  controllatoIl: string;
  letti: number;
  pertinenti: number;
  nuovi: number;
  importati: number;
  duplicati: number;
  scartati: number;
  errori: number;
  idImportati: number[];
  voci: Array<{ titolo: string; link: string; esito: string; motivo?: string }>;
  errore?: string;
}

/** Controllo del numero di oggi della Gazzetta. Mai un'eccezione. */
export async function importaGazzetta(db: Client, opz: { prova?: boolean; budgetMs?: number } = {}): Promise<EsitoGazzetta> {
  const t0 = Date.now();
  const budgetMs = opz.budgetMs ?? 60_000;
  const esito: EsitoGazzetta = { controllatoIl: new Date().toISOString(), letti: 0, pertinenti: 0, nuovi: 0, importati: 0, duplicati: 0, scartati: 0, errori: 0, idImportati: [], voci: [] };
  let atti: AttoGazzetta[];
  try {
    const res = await fetch(FEED_GU, { headers: { "user-agent": USER_AGENT, accept: "application/rss+xml,application/xml" }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    const xml = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    atti = parseRssGazzetta(xml);
    if (!atti.length) throw new Error("feed senza atti: la Gazzetta potrebbe aver cambiato formato");
  } catch (err) {
    return { ...esito, errore: `feed della Gazzetta non leggibile: ${(err as Error).message.slice(0, 160)}` };
  }
  esito.letti = atti.length;
  const pertinenti = atti.filter(pertinenteGazzetta);
  esito.pertinenti = pertinenti.length;
  if (!pertinenti.length) return esito;
  if (!opz.prova) await assicuraSchema(db);
  const note = opz.prova ? new Map() : await vociNote(db, pertinenti.map((a) => a.link));
  for (const a of pertinenti) {
    const nota = note.get(a.link);
    if (nota && !(nota.stato === "errore" && nota.tentativi < 3)) continue;
    esito.nuovi++;
    if (Date.now() - t0 > budgetMs) {
      esito.voci.push({ titolo: a.titolo, link: a.link, esito: "rimandata", motivo: "tempo esaurito" });
      continue;
    }
    const base = { url: a.link, fonte: FONTE_GU, titoloFonte: a.titolo, oggetto: a.oggetto };
    const dest = destinazioneGazzetta(a.tipo);
    const anno = Number((a.data ?? a.pubblicazione).slice(0, 4));
    const chiave = chiaveAtto(dest.chiave, a.numero, anno, a.data);
    try {
      const res = await fetch(urlTestoGazzetta(a), { headers: { "user-agent": USER_AGENT }, cache: "no-store", signal: AbortSignal.timeout(25_000) });
      if (!res.ok) throw new Error(`testo dell'atto: HTTP ${res.status}`);
      const testo = `${a.titolo}\n${a.oggetto}\n\n${testoDaHtmlGazzetta(await res.text())}`;
      if (testo.length < 400) throw new Error("testo dell'atto troppo breve");
      const meta = valutaMetadati(a.titolo, a.oggetto);
      const valutazione = valutaTesto(testo, { ...meta, scarica: true });
      const sha256 = createHash("sha256").update(testo).digest("hex");
      if (!valutazione.pertinente) {
        esito.scartati++;
        esito.voci.push({ titolo: a.titolo, link: a.link, esito: "non_pertinente", motivo: valutazione.motivo });
        if (!opz.prova) await registraVoce(db, { ...base, tipo: dest.chiave, numero: a.numero, data: a.data, anno, chiave, stato: "non_pertinente", motivo: valutazione.motivo, punteggio: valutazione.punteggio, sha256 });
        continue;
      }
      const duplicato = opz.prova ? null : await cercaDuplicato(db, dest.chiave, a.numero, anno, a.link, a.oggetto);
      if (duplicato) {
        esito.duplicati++;
        esito.voci.push({ titolo: a.titolo, link: a.link, esito: "duplicato" });
        await registraVoce(db, { ...base, tipo: dest.chiave, numero: a.numero, data: a.data, anno, chiave, stato: "duplicato", motivo: `già presente nel corpus (documento #${duplicato})`, docId: duplicato, sha256 });
        continue;
      }
      const dataBreve = a.data ? a.data.split("-").reverse().join("/") : null;
      const titolo = `${dest.abbrev}${a.numero ? ` ${a.numero}` : dataBreve ? ` del ${dataBreve}` : ""} - ${oggettoDiRipiego(a.oggetto || a.titolo)}`;
      if (opz.prova) {
        esito.voci.push({ titolo, link: a.link, esito: "da_importare", motivo: valutazione.motivo });
        continue;
      }
      const docId = await inserisciDocumento(db, { cartella: dest.cartella, nomeFile: a.link, titolo, anno, testo, tipo: dest.chiave, numero: a.numero, data: a.data, sha256 });
      await registraVoce(db, {
        ...base, tipo: dest.chiave, numero: a.numero, data: a.data, anno, chiave, stato: "importato",
        motivo: `Gazzetta Ufficiale del ${a.pubblicazione.split("-").reverse().join("/")}: ${valutazione.motivo}`, punteggio: valutazione.punteggio,
        docId, sha256, titolo, cartella: dest.cartella, testo,
      });
      esito.importati++;
      esito.idImportati.push(docId);
      esito.voci.push({ titolo, link: a.link, esito: "importato" });
    } catch (err) {
      esito.errori++;
      const motivo = (err as Error).message.slice(0, 200);
      esito.voci.push({ titolo: a.titolo, link: a.link, esito: "errore", motivo });
      if (!opz.prova) await registraVoce(db, { ...base, tipo: dest.chiave, numero: a.numero, data: a.data, anno, chiave, stato: "errore", motivo, incrementaTentativi: true }).catch(() => undefined);
    }
  }
  return esito;
}

/* -------------------------------------------------------------------------- */
/* Ultimo controllo (per /aggiornamenti)                                       */
/* -------------------------------------------------------------------------- */

export type { ControlloQuotidiano } from "./tipi";

const DDL_CONTROLLI = `CREATE TABLE IF NOT EXISTS fonti_quotidiane (
  fonte TEXT PRIMARY KEY, nome TEXT NOT NULL, controllato_il TEXT NOT NULL,
  letti INTEGER NOT NULL, pertinenti INTEGER NOT NULL, importati INTEGER NOT NULL, errore TEXT
)`;

export async function registraControllo(db: Client, e: EsitoGazzetta): Promise<void> {
  await db.execute(DDL_CONTROLLI);
  await db.execute({
    sql: `INSERT INTO fonti_quotidiane (fonte, nome, controllato_il, letti, pertinenti, importati, errore) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(fonte) DO UPDATE SET controllato_il = excluded.controllato_il, letti = excluded.letti,
            pertinenti = excluded.pertinenti, importati = excluded.importati, errore = excluded.errore`,
    args: [FONTE_GU, "Gazzetta Ufficiale · Serie Generale", e.controllatoIl, e.letti, e.pertinenti, e.importati, e.errore ?? null],
  });
}

export async function controlliQuotidiani(db: Client): Promise<ControlloQuotidiano[]> {
  try {
    const rs = await db.execute(`SELECT fonte, nome, controllato_il, letti, pertinenti, importati, errore FROM fonti_quotidiane ORDER BY fonte`);
    return rs.rows.map((r) => ({
      fonte: String(r.fonte),
      nome: String(r.nome),
      controllatoIl: String(r.controllato_il),
      letti: Number(r.letti ?? 0),
      pertinenti: Number(r.pertinenti ?? 0),
      importati: Number(r.importati ?? 0),
      errore: r.errore == null ? null : String(r.errore),
    }));
  } catch {
    return []; // tabella non ancora creata
  }
}
