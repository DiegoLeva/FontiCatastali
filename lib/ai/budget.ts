import { AsyncLocalStorage } from "node:async_hooks";
import type { Client } from "@libsql/client";
import { getDb } from "@/lib/db";

/**
 * Budget giornaliero di Workers AI con TETTO RIGIDO (obiettivo: 0 € extra).
 *
 * Cloudflare include 10.000 neuroni al giorno per account, azzerati alle 00:00
 * UTC; sul piano Workers Paid ogni neurone oltre viene addebitato. Qui ogni
 * chiamata ai modelli PRENOTA prima di partire il suo costo massimo (token di
 * input stimati + max_tokens di output, +15%) con un UPDATE atomico su Turso
 * che riesce solo se resta sotto il tetto; a risposta ricevuta la prenotazione
 * si SALDA sui token reali (+15%). Se il tetto e' raggiunto, o il contatore
 * non e' raggiungibile, la chiamata NON parte: si fallisce chiusi.
 *
 *   - tetto globale: 8.800 neuroni/giorno (1.200 di margine sotto i 10.000);
 *   - riserva protetta: 2.000 neuroni per Normie e cron (lo Studio si ferma a 6.800);
 *   - giorno di installazione: quota considerata gia' consumata (prudenza);
 *   - se il token Cloudflare puo' leggere le analytics, il contatore si
 *     allinea al consumo REALE dell'account (anche di altri progetti).
 */

export type ServizioAi = "studio" | "normie" | "cron" | "altro";
const COLONNE: Record<ServizioAi, string> = { studio: "studio", normie: "normie", cron: "cron", altro: "altro" };

function intero(v: string | undefined, predefinito: number, min: number, max: number): number {
  if (v === undefined || v.trim() === "") return predefinito;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : predefinito;
}

/** Allocazione gratuita giornaliera dell'account Cloudflare. */
export const QUOTA_GRATUITA = 10_000;
/** Tetto dell'app; configurabile ma mai oltre 9.500 (resta margine sotto i 10.000). */
export const LIMITE_GIORNO = intero(process.env.AI_NEURONI_GIORNO, 8_800, 0, 9_500);
/** Neuroni riservati a Normie e cron: lo Studio non puo' intaccarli. */
export const RISERVA_PROTETTA = intero(process.env.AI_NEURONI_RISERVA, 2_000, 0, LIMITE_GIORNO);
export const LIMITE_STUDIO = LIMITE_GIORNO - RISERVA_PROTETTA;
/** Margine prudenziale su stime e consumi dichiarati. */
export const MARGINE = 1.15;

/**
 * Neuroni per milione di token (listino Workers AI, novembre 2026). Un modello
 * assente dal listino usa una tariffa volutamente alta: prenota di piu'.
 */
export const TARIFFE: Record<string, { input: number; output: number }> = {
  "@cf/google/gemma-4-26b-a4b-it": { input: 9_091, output: 27_273 },
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": { input: 26_668, output: 204_805 },
  "@cf/meta/llama-3.1-70b-instruct-fp8-fast": { input: 26_668, output: 204_805 },
  "@cf/qwen/qwen3-30b-a3b-fp8": { input: 4_625, output: 30_475 },
  "@cf/openai/gpt-oss-20b": { input: 18_182, output: 27_273 },
  "@cf/openai/gpt-oss-120b": { input: 31_818, output: 68_182 },
  "@cf/zai-org/glm-5.3-flash": { input: 13_636, output: 45_455 },
  "@cf/baai/bge-m3": { input: 1_075, output: 0 },
  "@cf/google/embeddinggemma-2": { input: 154, output: 0 },
  "@cf/baai/bge-reranker-base": { input: 283, output: 0 },
};
const TARIFFA_IGNOTA = { input: 120_000, output: 450_000 };

export const tariffa = (modello: string) => TARIFFE[modello] ?? TARIFFA_IGNOTA;

/** Stima prudenziale dei token: l'italiano sta sui 3,6-4 caratteri per token. */
export const stimaToken = (caratteri: number) => Math.ceil(Math.max(0, caratteri) / 3);

/** Neuroni (senza margine) di una chiamata. */
export function neuroni(modello: string, tokenIn: number, tokenOut: number): number {
  const t = tariffa(modello);
  return (Math.max(0, tokenIn) * t.input + Math.max(0, tokenOut) * t.output) / 1_000_000;
}

export const giornoUtc = (d = new Date()) => d.toISOString().slice(0, 10);
const arrotonda = (n: number) => Math.round(n * 100) / 100;

/* -------------------------------------------------------------------------- */
/* Contesto della richiesta: quale servizio consuma (e un eventuale tetto)     */
/* -------------------------------------------------------------------------- */

export interface TettoLocale {
  nome: string;
  limite: number;
  usati: number;
}

interface Contesto {
  servizio: ServizioAi;
  tetto?: TettoLocale;
}

const contesto = new AsyncLocalStorage<Contesto>();

/** Esegue `fn` attribuendo le chiamate AI a `servizio` (e al `tetto` locale, se dato). */
export function conServizioAi<T>(servizio: ServizioAi, fn: () => T, tetto?: TettoLocale): T {
  return contesto.run({ servizio, tetto }, fn);
}

export const contestoCorrente = (): Contesto => contesto.getStore() ?? { servizio: "altro" };

/** Chiamata AI non inviata: budget esaurito o contatore non disponibile. */
export class BudgetAiEsaurito extends Error {
  constructor(
    message: string,
    readonly ambito: "giorno" | "studio" | "dossier" | "contatore"
  ) {
    super(message);
    this.name = "BudgetAiEsaurito";
  }
}

/* -------------------------------------------------------------------------- */
/* Schema                                                                      */
/* -------------------------------------------------------------------------- */

const DDL = [
  `CREATE TABLE IF NOT EXISTS ai_daily_usage (
     giorno TEXT PRIMARY KEY,
     neuroni REAL NOT NULL DEFAULT 0,
     studio REAL NOT NULL DEFAULT 0,
     normie REAL NOT NULL DEFAULT 0,
     cron REAL NOT NULL DEFAULT 0,
     altro REAL NOT NULL DEFAULT 0,
     chiamate INTEGER NOT NULL DEFAULT 0,
     bloccate INTEGER NOT NULL DEFAULT 0,
     remoto REAL,
     remoto_il TEXT,
     nota TEXT,
     aggiornato_il TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS ai_usage_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     ts TEXT NOT NULL,
     giorno TEXT NOT NULL,
     servizio TEXT NOT NULL,
     modello TEXT NOT NULL,
     token_in INTEGER,
     token_out INTEGER,
     prenotati REAL NOT NULL,
     neuroni REAL NOT NULL,
     esito TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_ai_usage_log_giorno ON ai_usage_log(giorno)`,
];

let pronto: Promise<boolean> | null = null;

async function assicura(db: Client): Promise<boolean> {
  if (!pronto) {
    pronto = (async () => {
      const esisteva =
        (await db.execute(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ai_daily_usage'`)).rows.length > 0;
      await db.batch(DDL, "write");
      if (!esisteva && process.env.AI_SEED_INSTALLAZIONE !== "0") {
        // Nel giorno in cui il contatore nasce non si sa quanto sia gia' stato
        // consumato: si assume la quota esaurita fino alla mezzanotte UTC.
        await db.execute({
          sql: `INSERT OR IGNORE INTO ai_daily_usage (giorno, neuroni, altro, nota, aggiornato_il) VALUES (?, ?, ?, ?, ?)`,
          args: [giornoUtc(), LIMITE_GIORNO, LIMITE_GIORNO, "Giorno di installazione del contatore: quota considerata già consumata (prudenza).", new Date().toISOString()],
        });
      }
      const trentaGiorniFa = giornoUtc(new Date(Date.now() - 30 * 86_400_000));
      await db.execute({ sql: `DELETE FROM ai_usage_log WHERE giorno < ?`, args: [trentaGiorniFa] }).catch(() => undefined);
      return true;
    })().catch((err) => {
      console.warn("[ai] contatore neuroni non disponibile:", (err as Error).message);
      pronto = null;
      return false;
    });
  }
  return pronto;
}

/* -------------------------------------------------------------------------- */
/* Allineamento al consumo reale dell'account (GraphQL Analytics, facoltativo) */
/* -------------------------------------------------------------------------- */

let ultimaSync = 0;
let sincronizzazione: { attiva: boolean | null; errore?: string; il?: string } = { attiva: null };
const OGNI_MS = 5 * 60_000;
const DOPO_ERRORE_MS = 6 * 3_600_000;

/** Neuroni consumati oggi (UTC) dall'intero account, se il token lo consente. */
export async function consumoRemotoOggi(giorno = giornoUtc()): Promise<number | null> {
  const account = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_API_TOKEN;
  if (!account || !token || process.env.AI_SYNC_REMOTA === "0") return null;
  const query = `query($a: string!, $g: Date!) { viewer { accounts(filter: { accountTag: $a }) {
      aiInferenceAdaptiveGroups(limit: 1, filter: { date_geq: $g, date_leq: $g }) { sum { totalNeurons } } } } }`;
  const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { a: account, g: giorno } }),
    signal: AbortSignal.timeout(6_000),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as {
    data?: { viewer?: { accounts?: Array<{ aiInferenceAdaptiveGroups?: Array<{ sum?: { totalNeurons?: number } }> }> } };
    errors?: Array<{ message?: string }>;
  } | null;
  if (!res.ok || json?.errors?.length) {
    throw new Error(json?.errors?.[0]?.message || `HTTP ${res.status}`);
  }
  const gruppi = json?.data?.viewer?.accounts?.[0]?.aiInferenceAdaptiveGroups ?? [];
  return gruppi.reduce((s, g) => s + Number(g.sum?.totalNeurons ?? 0), 0);
}

async function sincronizza(db: Client, giorno: string, forza = false): Promise<void> {
  const attesa = sincronizzazione.attiva === false ? DOPO_ERRORE_MS : OGNI_MS;
  if (!forza && Date.now() - ultimaSync < attesa) return;
  ultimaSync = Date.now();
  try {
    const remoto = await consumoRemotoOggi(giorno);
    if (remoto === null) {
      sincronizzazione = { attiva: false, errore: "non configurata" };
      return;
    }
    const il = new Date().toISOString();
    await db.batch(
      [
        { sql: `INSERT INTO ai_daily_usage (giorno) VALUES (?) ON CONFLICT(giorno) DO NOTHING`, args: [giorno] },
        {
          sql: `UPDATE ai_daily_usage SET remoto = ?, remoto_il = ?, neuroni = MAX(neuroni, ?), aggiornato_il = ? WHERE giorno = ?`,
          args: [arrotonda(remoto), il, arrotonda(remoto), il, giorno],
        },
      ],
      "write"
    );
    sincronizzazione = { attiva: true, il };
  } catch (err) {
    sincronizzazione = { attiva: false, errore: (err as Error).message.slice(0, 160) };
  }
}

/* -------------------------------------------------------------------------- */
/* Prenotazione e saldo                                                        */
/* -------------------------------------------------------------------------- */

export interface Prenotazione {
  giorno: string;
  servizio: ServizioAi;
  modello: string;
  neuroni: number;
  tetto?: TettoLocale;
}

/**
 * Riserva `stima` neuroni (senza margine: lo aggiunge qui) per una chiamata a
 * `modello`. Lancia BudgetAiEsaurito se si supererebbe il tetto del servizio,
 * il tetto locale (es. del singolo dossier) o se il contatore non risponde.
 */
export async function prenota(modello: string, stima: number): Promise<Prenotazione> {
  const { servizio, tetto } = contestoCorrente();
  const importo = arrotonda(Math.max(0.01, stima * MARGINE));
  if (tetto && tetto.usati + importo > tetto.limite) {
    throw new BudgetAiEsaurito(`Budget di ${tetto.nome} esaurito (${Math.round(tetto.usati)}/${tetto.limite} neuroni).`, "dossier");
  }
  let db: Client;
  try {
    db = getDb();
  } catch {
    throw new BudgetAiEsaurito("Contatore dei neuroni non configurato: chiamate AI sospese per prudenza.", "contatore");
  }
  if (!(await assicura(db))) {
    throw new BudgetAiEsaurito("Contatore dei neuroni non raggiungibile: chiamate AI sospese per prudenza.", "contatore");
  }
  const giorno = giornoUtc();
  await sincronizza(db, giorno);
  const limite = servizio === "studio" ? LIMITE_STUDIO : LIMITE_GIORNO;
  const col = COLONNE[servizio];
  const adesso = new Date().toISOString();
  let accettata = false;
  try {
    const rs = await db.batch(
      [
        { sql: `INSERT INTO ai_daily_usage (giorno) VALUES (?) ON CONFLICT(giorno) DO NOTHING`, args: [giorno] },
        {
          sql: `UPDATE ai_daily_usage SET neuroni = neuroni + ?, ${col} = ${col} + ?, chiamate = chiamate + 1, aggiornato_il = ?
                WHERE giorno = ? AND neuroni + ? <= ? RETURNING neuroni`,
          args: [importo, importo, adesso, giorno, importo, limite],
        },
      ],
      "write"
    );
    accettata = rs[1].rows.length > 0;
  } catch (err) {
    throw new BudgetAiEsaurito(`Contatore dei neuroni non aggiornabile (${(err as Error).message.slice(0, 80)}): chiamate AI sospese.`, "contatore");
  }
  if (!accettata) {
    db.execute({ sql: `UPDATE ai_daily_usage SET bloccate = bloccate + 1 WHERE giorno = ?`, args: [giorno] }).catch(() => undefined);
    throw new BudgetAiEsaurito(
      servizio === "studio"
        ? `Budget giornaliero dello Studio esaurito (${LIMITE_STUDIO} neuroni; ${RISERVA_PROTETTA} restano riservati a Normie).`
        : `Budget AI giornaliero esaurito (${LIMITE_GIORNO} neuroni).`,
      servizio === "studio" ? "studio" : "giorno"
    );
  }
  if (tetto) tetto.usati += importo;
  return { giorno, servizio, modello, neuroni: importo, tetto };
}

/**
 * Chiude una prenotazione. `effettivi` sono i neuroni reali (senza margine);
 * null = sconosciuti (si tiene la prenotazione intera, per prudenza); 0 =
 * richiesta rifiutata prima dell'elaborazione (rimborso completo).
 */
export async function salda(
  p: Prenotazione,
  effettivi: number | null,
  dettagli: { tokenIn?: number; tokenOut?: number; esito: string }
): Promise<void> {
  const finale = effettivi === null ? p.neuroni : arrotonda(effettivi * MARGINE);
  const delta = arrotonda(finale - p.neuroni);
  if (p.tetto) p.tetto.usati += delta;
  const col = COLONNE[p.servizio];
  const adesso = new Date().toISOString();
  try {
    await getDb().batch(
      [
        {
          sql: `UPDATE ai_daily_usage SET neuroni = MAX(0, neuroni + ?), ${col} = MAX(0, ${col} + ?), aggiornato_il = ? WHERE giorno = ?`,
          args: [delta, delta, adesso, p.giorno],
        },
        {
          sql: `INSERT INTO ai_usage_log (ts, giorno, servizio, modello, token_in, token_out, prenotati, neuroni, esito) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [adesso, p.giorno, p.servizio, p.modello, dettagli.tokenIn ?? null, dettagli.tokenOut ?? null, p.neuroni, finale, dettagli.esito.slice(0, 60)],
        },
      ],
      "write"
    );
  } catch (err) {
    // Se il saldo non riesce resta la prenotazione (che e' gia' il massimo).
    console.warn("[ai] saldo neuroni non registrato:", (err as Error).message);
  }
}

/** Neuroni ancora disponibili oggi per il servizio corrente (o indicato). */
export async function disponibili(servizio: ServizioAi = contestoCorrente().servizio): Promise<number> {
  const s = await statoBudget(true);
  if (s.nonDisponibile) return 0;
  return Math.max(0, (servizio === "studio" ? LIMITE_STUDIO : LIMITE_GIORNO) - s.usati);
}

/* -------------------------------------------------------------------------- */
/* Stato per pagine e API                                                      */
/* -------------------------------------------------------------------------- */

export interface StatoBudget {
  giorno: string;
  limite: number;
  limiteStudio: number;
  riserva: number;
  quotaGratuita: number;
  usati: number;
  perServizio: Record<ServizioAi, number>;
  chiamate: number;
  bloccate: number;
  remoto: number | null;
  remotoIl: string | null;
  sincronizzazione: { attiva: boolean | null; errore?: string };
  nota: string | null;
  disponibile: boolean;
  /** Contatore non configurato o non raggiungibile: AI sospesa per prudenza. */
  nonDisponibile?: boolean;
}

export async function statoBudget(sincronizzaOra = false): Promise<StatoBudget> {
  const giorno = giornoUtc();
  const vuoto: StatoBudget = {
    giorno,
    limite: LIMITE_GIORNO,
    limiteStudio: LIMITE_STUDIO,
    riserva: RISERVA_PROTETTA,
    quotaGratuita: QUOTA_GRATUITA,
    usati: 0,
    perServizio: { studio: 0, normie: 0, cron: 0, altro: 0 },
    chiamate: 0,
    bloccate: 0,
    remoto: null,
    remotoIl: null,
    sincronizzazione: { ...sincronizzazione },
    nota: null,
    disponibile: false,
    nonDisponibile: true,
  };
  let db: Client;
  try {
    db = getDb();
  } catch {
    return vuoto;
  }
  if (!(await assicura(db))) return vuoto;
  if (sincronizzaOra) await sincronizza(db, giorno);
  const rs = await db.execute({ sql: `SELECT * FROM ai_daily_usage WHERE giorno = ?`, args: [giorno] });
  const r = rs.rows[0];
  const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
  const usati = n(r?.neuroni);
  return {
    ...vuoto,
    usati: arrotonda(usati),
    perServizio: { studio: arrotonda(n(r?.studio)), normie: arrotonda(n(r?.normie)), cron: arrotonda(n(r?.cron)), altro: arrotonda(n(r?.altro)) },
    chiamate: n(r?.chiamate),
    bloccate: n(r?.bloccate),
    remoto: r?.remoto === null || r?.remoto === undefined ? null : arrotonda(Number(r.remoto)),
    remotoIl: r?.remoto_il ? String(r.remoto_il) : null,
    sincronizzazione: { ...sincronizzazione },
    nota: r?.nota ? String(r.nota) : null,
    disponibile: usati < LIMITE_GIORNO,
    nonDisponibile: false,
  };
}

/** Solo per i test: azzera lo stato in memoria del modulo. */
export function _azzeraPerTest(): void {
  pronto = null;
  ultimaSync = 0;
  sincronizzazione = { attiva: null };
}
