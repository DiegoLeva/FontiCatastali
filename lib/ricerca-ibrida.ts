import type { Client } from "@libsql/client";
import { embed, vectorSearchIds } from "@/lib/cloudflare";
import { conServizioAi } from "@/lib/ai/budget";
import { prenotaQueryVectorize } from "@/lib/ai/vectorize";
import { testiPassaggi } from "@/lib/ai/passaggi";
import { MARK_END, MARK_START, snippetToSafeHtml } from "@/lib/fts";

/**
 * Ricerca ibrida della home: testuale (FTS di Turso) + per significato
 * (Vectorize), fuse con Reciprocal Rank Fusion.
 *
 *   - Codici ed estremi esatti (F/3, Circ. 2/2016, D.P.R. 1142/1949, n. 557,
 *     12/E, testo tra virgolette): sempre e solo testuale, 0 neuroni e 0 query.
 *   - Domande discorsive ("come si accatasta un pannello fotovoltaico?") o
 *     interruttore "Ricerca ibrida" acceso: anche per significato.
 *   - Tetti AI/Vectorize raggiunti, indice incompleto o errori: si resta
 *     sulla testuale, in silenzio (al massimo una nota nella risposta).
 *
 * Costo di una ricerca ibrida: un embedding della query (~0,003 neuroni) e
 * una query Vectorize (contata nel tetto mensile delle dimensioni interrogate).
 */

const CODICI: RegExp[] = [
  /(?<![\p{L}\d])[a-f]\s*\/\s*\d{1,2}(?![\p{L}\d])/iu, // F/3, D/1, A/10
  /(?<!\d)\d{1,5}\s*\/\s*(?:(?:18|19|20)\d{2}|[a-z]{1,2})(?![\p{L}\d])/iu, // 2/2016, 12/E, 49/T
  /(?<![\p{L}])(?:circ(?:olare)?|ris(?:oluzione)?|provv?(?:edimento)?|nota|d\.?\s*p\.?\s*r|d\.?\s*lgs|d\.?\s*l|d\.?\s*m|r\.?\s*d|legge|l|decreto|art(?:icolo)?|comma)\.?\s*(?:n\.?\s*°?\s*)?\d+/iu,
  /(?<![\p{L}])n\.?\s*°?\s*\d+/iu, // "n. 557"
  /^\s*["«“].+["»”]\s*$/u, // tra virgolette
];

/** La query contiene un codice, un numero di atto o estremi esatti? */
export const eCodiceEsatto = (q: string) => CODICI.some((re) => re.test(q));

const INTERROGATIVE =
  /^(?:come|quando|perch[eé]|cosa|che cosa|quale|quali|qual|chi|dove|quanto|quanti|quante|in che|in quali|si pu[oò]|posso|devo|bisogna|serve|occorre|[eè] possibile|[eè] necessario)\b/i;

/** Domanda o frase discorsiva (dove la sola FTS rende poco). */
export function eDiscorsiva(q: string): boolean {
  const t = q.trim();
  return t.includes("?") || INTERROGATIVE.test(t) || t.split(/\s+/).filter((p) => p.length > 1).length >= 6;
}

export type ModoRicerca = "testuale" | "ibrida";

export function decidiModo(q: string, opz: { ibrida: boolean; exact: boolean }): { modo: ModoRicerca; motivo: string } {
  if (opz.exact) return { modo: "testuale", motivo: "ricerca esatta" };
  if (eCodiceEsatto(q)) return { modo: "testuale", motivo: "codice o estremi esatti" };
  if (opz.ibrida) return { modo: "ibrida", motivo: "ricerca ibrida attiva" };
  if (eDiscorsiva(q)) return { modo: "ibrida", motivo: "domanda discorsiva" };
  return { modo: "testuale", motivo: "predefinita" };
}

/** Soglia del coseno (EmbeddingGemma) per i documenti trovati solo per significato. */
export const SOGLIA_SEMANTICA = Number(process.env.RICERCA_SOGLIA_SEMANTICA || 0.35);

export interface RisultatoSemantico {
  score: number;
  /** Id del passaggio piu' vicino ("<docId>-<ord>"). */
  passaggio: string;
}

/** Documenti piu' vicini per significato (null = canale non disponibile ora). */
export async function cercaPerSignificato(q: string, topK = 80): Promise<Map<number, RisultatoSemantico> | null> {
  if (!(await prenotaQueryVectorize())) return null;
  try {
    const matches = await conServizioAi("altro", async () => vectorSearchIds(await embed(q), Math.min(100, topK)));
    const out = new Map<number, RisultatoSemantico>();
    for (const m of matches) {
      const id = Number(String(m.id).split("-")[0]);
      if (!Number.isFinite(id)) continue;
      const prima = out.get(id);
      if (!prima || m.score > prima.score) out.set(id, { score: m.score, passaggio: String(m.id) });
    }
    return out;
  } catch (err) {
    console.warn("[ricerca ibrida] canale semantico non disponibile:", (err as Error).message.slice(0, 160));
    return null;
  }
}

/** Reciprocal Rank Fusion (k = 60) di liste ordinate di id. */
export function fondiRrf(liste: number[][], k = 60): Array<{ id: number; punteggio: number }> {
  const punti = new Map<number, number>();
  for (const lista of liste) lista.forEach((id, i) => punti.set(id, (punti.get(id) ?? 0) + 1 / (k + i + 1)));
  return [...punti.entries()].map(([id, punteggio]) => ({ id, punteggio })).sort((a, b) => b.punteggio - a.punteggio || a.id - b.id);
}

const radice = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").slice(0, 5);

/** Snippet sicuro del passaggio con le parole della query evidenziate. */
export function snippetPassaggio(testo: string, q: string, max = 260): string {
  const pulito = testo.replace(/\s+/g, " ").trim();
  const radici = [...new Set(q.split(/[^\p{L}\d]+/u).filter((p) => p.length >= 4).map(radice))];
  // Finestra attorno alla prima parola della query, se c'e'.
  let inizio = 0;
  const parole = [...pulito.matchAll(/[\p{L}\d]+/gu)];
  const prima = parole.find((m) => radici.includes(radice(m[0])));
  if (prima && (prima.index ?? 0) > 80) inizio = Math.max(0, (prima.index ?? 0) - 80);
  const finestra = pulito.slice(inizio, inizio + max);
  const marcato = finestra.replace(/[\p{L}\d]+/gu, (p) => (p.length >= 4 && radici.includes(radice(p)) ? `${MARK_START}${p}${MARK_END}` : p));
  return snippetToSafeHtml(`${inizio > 0 ? "… " : ""}${marcato}${inizio + max < pulito.length ? " …" : ""}`);
}

export interface DocSemantico {
  id: number;
  cartella: string;
  nomeFile: string;
  titolo: string;
  anno: unknown;
  snippetHtml: string;
}

/** Metadati e snippet dei documenti trovati solo per significato. */
export async function documentiSemantici(db: Client, ids: number[], sem: Map<number, RisultatoSemantico>, q: string): Promise<DocSemantico[]> {
  if (!ids.length) return [];
  const passaggi = await testiPassaggi(db, ids.map((id) => sem.get(id)!.passaggio));
  const out: DocSemantico[] = [];
  for (const id of ids) {
    const p = passaggi.get(sem.get(id)!.passaggio);
    if (!p) continue;
    out.push({ id, cartella: p.cartella, nomeFile: p.nomeFile, titolo: p.titolo, anno: p.anno, snippetHtml: snippetPassaggio(p.testo, q) });
  }
  return out;
}
