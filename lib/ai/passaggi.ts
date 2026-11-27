import type { Client } from "@libsql/client";

/**
 * Passaggi del corpus indicizzati su Vectorize.
 *
 * Il testo NON viene copiato: per ogni passaggio Turso conserva solo l'offset
 * e la lunghezza nel testo integrale (`documenti.testo_estratto`), e Normie lo
 * ritaglia con substr() al momento della risposta. Niente D1, niente doppioni
 * del corpus, e titoli/anni sempre quelli correnti (anche dopo una bonifica).
 *
 * Gli offset sono in CARATTERI (code point), come substr() di SQLite, non in
 * unita' UTF-16 di JavaScript: i caratteri fuori dal piano base (emoji,
 * simboli matematici) contano 1.
 */

export const PASSAGGIO_MAX = 2000;
const PASSAGGIO_MIN = 1200;
/** Passaggi con meno caratteri utili (es. solo numeri di pagina) si scartano. */
const MIN_UTILE = 80;

export interface Passaggio {
  ord: number;
  /** Offset (0-based, in code point) nel testo integrale. */
  inizio: number;
  /** Lunghezza in code point. */
  lunghezza: number;
}

/** Fine dell'ultima occorrenza di `re` in `s` (indice dopo il separatore), o null. */
function ultimo(s: string, re: RegExp): number | null {
  let fine: number | null = null;
  for (const m of s.matchAll(re)) fine = (m.index ?? 0) + m[0].length;
  return fine;
}

/** Indici UTF-16 -> code point (solo se il testo ha coppie surrogate). */
function convertitore(testo: string): (i: number) => number {
  if (!/[\uD800-\uDFFF]/.test(testo)) return (i) => i;
  const prima: number[] = [];
  let basse = 0;
  for (let i = 0; i <= testo.length; i++) {
    prima.push(i - basse);
    const c = testo.charCodeAt(i);
    if (c >= 0xdc00 && c <= 0xdfff && i > 0) {
      const p = testo.charCodeAt(i - 1);
      if (p >= 0xd800 && p <= 0xdbff) basse++;
    }
  }
  return (i) => prima[Math.min(i, prima.length - 1)];
}

/**
 * Divide il testo in passaggi di al massimo PASSAGGIO_MAX caratteri, tagliando
 * di preferenza a fine paragrafo, poi a fine riga, poi a fine frase. Funzione
 * pura e deterministica: stesso testo, stessi passaggi (gli id dei vettori
 * "<docId>-<ord>" restano stabili tra un'esecuzione e l'altra).
 */
export function spezzaInPassaggi(testo: string, max = PASSAGGIO_MAX, min = PASSAGGIO_MIN): Passaggio[] {
  const cp = convertitore(testo);
  const out: Passaggio[] = [];
  const n = testo.length;
  let p = 0;
  while (p < n) {
    while (p < n && /\s/.test(testo[p])) p++;
    if (p >= n) break;
    let fine = Math.min(n, p + max);
    if (fine < n) {
      const finestra = testo.slice(p + min, fine);
      const taglio =
        ultimo(finestra, /\n[ \t]*\n/g) ??
        ultimo(finestra, /\n/g) ??
        ultimo(finestra, /[.;:!?»"')\]]\s/g) ??
        ultimo(finestra, /\s/g);
      if (taglio !== null && taglio > 0) fine = p + min + taglio;
      // Non spezzare una coppia surrogata.
      const c = testo.charCodeAt(fine - 1);
      if (c >= 0xd800 && c <= 0xdbff) fine++;
    }
    if (testo.slice(p, fine).replace(/\s/g, "").length >= MIN_UTILE) {
      const inizio = cp(p);
      out.push({ ord: out.length, inizio, lunghezza: cp(fine) - inizio });
    }
    p = fine;
  }
  return out;
}

/** Ritaglio in JavaScript di un passaggio (stessa semantica di substr() di SQLite). */
export function ritaglio(testo: string, p: Pick<Passaggio, "inizio" | "lunghezza">): string {
  if (!/[\uD800-\uDFFF]/.test(testo)) return testo.slice(p.inizio, p.inizio + p.lunghezza);
  return Array.from(testo).slice(p.inizio, p.inizio + p.lunghezza).join("");
}

/**
 * Al massimo `k` passaggi, distribuiti in modo uniforme sul documento (il
 * primo, che di solito contiene oggetto ed estremi, c'e' sempre). k <= 0 =
 * tutti. Serve a far stare i manuali di centinaia di pagine nel tetto di
 * dimensioni memorizzate senza sacrificare i documenti brevi: il resto del
 * testo resta comunque trovabile con la ricerca testuale.
 */
export function selezionaPassaggi<T>(passaggi: T[], k: number): T[] {
  if (k <= 0 || passaggi.length <= k) return passaggi;
  if (k === 1) return [passaggi[0]];
  const scelti = new Set<number>();
  for (let j = 0; j < k; j++) scelti.add(Math.round((j * (passaggi.length - 1)) / (k - 1)));
  return [...scelti].sort((a, b) => a - b).map((i) => passaggi[i]);
}

/** Stima prudenziale dei passaggi di un testo dalla sola lunghezza. */
export const stimaPassaggi = (caratteri: number) => (caratteri < MIN_UTILE ? 0 : Math.ceil(caratteri / 1700));

/**
 * Tetto per documento ("riempimento ad acqua"): il k piu' grande per cui
 * la somma di min(passaggi_i, k) resta entro `budget` vettori. 0 = nessun tetto.
 */
export function tettoPerDocumento(stime: number[], budget: number): number {
  const totale = stime.reduce((s, n) => s + n, 0);
  if (totale <= budget) return 0;
  let lo = 1;
  let hi = Math.max(1, ...stime);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const somma = stime.reduce((s, n) => s + Math.min(n, mid), 0);
    if (somma <= budget) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/* -------------------------------------------------------------------------- */
/* Schema su Turso                                                             */
/* -------------------------------------------------------------------------- */

const DDL = [
  `CREATE TABLE IF NOT EXISTS passaggi (
     id TEXT PRIMARY KEY,
     doc_id INTEGER NOT NULL,
     ord INTEGER NOT NULL,
     inizio INTEGER NOT NULL,
     lunghezza INTEGER NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_passaggi_doc ON passaggi(doc_id)`,
  `CREATE TABLE IF NOT EXISTS vectorize_documenti (
     doc_id INTEGER PRIMARY KEY,
     vettori INTEGER NOT NULL,
     totali INTEGER NOT NULL,
     caratteri INTEGER NOT NULL,
     modello TEXT NOT NULL,
     dimensioni INTEGER NOT NULL,
     indicizzato_il TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS vectorize_indice (chiave TEXT PRIMARY KEY, valore TEXT NOT NULL)`,
];

let pronto: Promise<boolean> | null = null;
export async function assicuraSchemaIndice(db: Client): Promise<boolean> {
  if (!pronto) {
    pronto = db
      .batch(DDL, "write")
      .then(() => true)
      .catch((err) => {
        console.warn("[indice] schema non disponibile:", (err as Error).message);
        pronto = null;
        return false;
      });
  }
  return pronto;
}

export interface TestoPassaggio {
  docId: number;
  titolo: string;
  cartella: string;
  nomeFile: string;
  anno: string;
  testo: string;
}

/** Testo (da Turso) e metadati correnti dei passaggi `ids` ("<docId>-<ord>"). */
export async function testiPassaggi(db: Client, ids: string[]): Promise<Map<string, TestoPassaggio>> {
  const out = new Map<string, TestoPassaggio>();
  if (!ids.length) return out;
  const rs = await db.execute({
    sql: `SELECT p.id, p.doc_id, d.titolo, d.cartella_origine AS cartella, d.nuovo_nome_file AS nome_file, d.anno,
                 substr(d.testo_estratto, p.inizio + 1, p.lunghezza) AS testo
          FROM passaggi p JOIN documenti d ON d.id = p.doc_id
          WHERE p.id IN (${ids.map(() => "?").join(",")})`,
    args: ids,
  });
  for (const r of rs.rows) {
    out.set(String(r.id), {
      docId: Number(r.doc_id),
      titolo: String(r.titolo ?? ""),
      cartella: String(r.cartella ?? ""),
      nomeFile: String(r.nome_file ?? ""),
      anno: String(r.anno ?? ""),
      testo: String(r.testo ?? "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim(),
    });
  }
  return out;
}

export interface RiepilogoIndice {
  /** "<modello>@<dimensioni>" della generazione in corso, o null. */
  generazione: string | null;
  completataIl: string | null;
  documenti: number;
  vettori: number;
}

let cacheRiepilogo: { il: number; dati: RiepilogoIndice } | null = null;

/** Stato dell'indice secondo Turso (cache di 2 minuti; `forza` la salta). */
export async function riepilogoIndice(db: Client, forza = false): Promise<RiepilogoIndice> {
  if (!forza && cacheRiepilogo && Date.now() - cacheRiepilogo.il < 120_000) return cacheRiepilogo.dati;
  const vuoto: RiepilogoIndice = { generazione: null, completataIl: null, documenti: 0, vettori: 0 };
  if (!(await assicuraSchemaIndice(db))) return vuoto;
  const [kv, somme] = await db.batch(
    [
      `SELECT chiave, valore FROM vectorize_indice WHERE chiave IN ('generazione', 'completata_il')`,
      `SELECT COUNT(*) AS n, COALESCE(SUM(vettori), 0) AS v FROM vectorize_documenti`,
    ],
    "read"
  );
  const mappa = new Map(kv.rows.map((r) => [String(r.chiave), String(r.valore)]));
  const dati: RiepilogoIndice = {
    generazione: mappa.get("generazione") ?? null,
    completataIl: mappa.get("completata_il") ?? null,
    documenti: Number(somme.rows[0]?.n ?? 0),
    vettori: Number(somme.rows[0]?.v ?? 0),
  };
  cacheRiepilogo = { il: Date.now(), dati };
  return dati;
}

export const invalidaRiepilogo = () => {
  cacheRiepilogo = null;
};

/** Solo per i test. */
export function _azzeraSchemaPerTest(): void {
  pronto = null;
  cacheRiepilogo = null;
}
