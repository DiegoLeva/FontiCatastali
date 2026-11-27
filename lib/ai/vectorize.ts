import type { Client } from "@libsql/client";
import { getDb } from "@/lib/db";
import { EMBEDDING_DIMS, EMBEDDING_MODEL, infoIndice } from "@/lib/cloudflare";
import { riepilogoIndice } from "@/lib/ai/passaggi";

/**
 * Guardiano delle quote Vectorize (obiettivo: 0 € extra).
 *
 * Quote incluse: Workers Free 5 milioni di dimensioni MEMORIZZATE e 30
 * milioni INTERROGATE al mese (oltre, le operazioni falliscono); Workers Paid
 * 10 e 50 milioni (oltre, si paga). Per Cloudflare le interrogate valgono
 * (query del mese + vettori memorizzati) × dimensioni. L'app resta sotto le
 * quote di ENTRAMBI i piani:
 *
 *   - memorizzate: tetto rigido di 4,5 milioni (VECTORIZE_MAX_MEMORIZZATE, mai
 *     oltre 9); un upsert che lo supererebbe non parte;
 *   - interrogate: contatore mensile su Turso con tetto rigido di 20 milioni
 *     (VECTORIZE_MAX_INTERROGATE), calcolato nel modo piu' prudente
 *     ((query + vettori) × dimensioni, come se ogni giorno avesse query); al
 *     tetto Normie, lo Studio e la ricerca ibrida tornano alla ricerca testuale;
 *   - niente query se l'indice non ha le dimensioni del modello di embedding
 *     o se la ricostruzione non e' finita (risultati parziali);
 *   - se le informazioni sull'indice non sono verificabili non si interroga.
 *
 * VECTORIZE_OLTRE_QUOTA=1 disattiva il guardiano (scelta consapevole di
 * accettare l'eventuale addebito). Lo stato e' visibile su /aggiornamenti.
 */

export const INCLUSE_INTERROGATE = 50_000_000;
export const INCLUSE_MEMORIZZATE = 10_000_000;

const intero = (v: string | undefined, def: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== "" ? Math.min(max, Math.max(min, Math.round(n))) : def;
};
/** Tetto rigido delle dimensioni memorizzate (default 4,5 M: sotto i 5 M del piano Free). */
export const TETTO_MEMORIZZATE = intero(process.env.VECTORIZE_MAX_MEMORIZZATE, 4_500_000, 0, 9_000_000);
/** Tetto rigido mensile delle dimensioni interrogate (default 20 M: sotto i 30 M del Free). */
export const TETTO_INTERROGATE = intero(process.env.VECTORIZE_MAX_INTERROGATE, 20_000_000, 0, 45_000_000);
const CACHE_INFO_MS = 30 * 60_000;

const meseUtc = (d = new Date()) => d.toISOString().slice(0, 7);
const oltreQuotaConsentito = () => process.env.VECTORIZE_OLTRE_QUOTA === "1";
const configurato = () => !!(process.env.CF_ACCOUNT_ID && process.env.CF_API_TOKEN && process.env.CF_VECTORIZE_INDEX);
export const generazioneCorrente = () => `${EMBEDDING_MODEL}@${EMBEDDING_DIMS}`;

let info: { il: number; dimensioni: number; vettori: number } | null = null;
let erroreInfo = "";

export async function leggiInfo(forza = false): Promise<{ dimensioni: number; vettori: number } | null> {
  if (!forza && info && Date.now() - info.il < CACHE_INFO_MS) return info;
  try {
    const i = await infoIndice();
    if (!i.dimensioni) throw new Error("dimensioni non indicate");
    info = { il: Date.now(), ...i };
    erroreInfo = "";
    return info;
  } catch (err) {
    erroreInfo = (err as Error).message.slice(0, 160);
    info = null;
    return null;
  }
}

export const ultimoErroreInfo = () => erroreInfo;

let pronto: Promise<boolean> | null = null;
async function assicura(db: Client): Promise<boolean> {
  if (!pronto) {
    pronto = db
      .execute(`CREATE TABLE IF NOT EXISTS vectorize_uso (mese TEXT PRIMARY KEY, query INTEGER NOT NULL DEFAULT 0, bloccate INTEGER NOT NULL DEFAULT 0, aggiornato_il TEXT)`)
      .then(() => true)
      .catch(() => {
        pronto = null;
        return false;
      });
  }
  return pronto;
}

export interface StatoVectorize {
  configurato: boolean;
  consentito: boolean;
  motivo: string;
  vettori: number;
  dimensioni: number;
  dimensioniModello: number;
  modello: string;
  memorizzate: number;
  tettoMemorizzate: number;
  interrogateMese: number;
  tettoInterrogate: number;
  queryMese: number;
  maxQueryMese: number;
  bloccateMese: number;
  oltreQuotaConsentito: boolean;
  /** Ricostruzione dell'indice: documenti e vettori gia' caricati. */
  indice: { pronto: boolean; documenti: number; vettori: number; completataIl: string | null };
}

/** Vettori da usare nei conti: il massimo tra Vectorize (asincrono) e Turso. */
const vettoriDi = (i: { vettori: number }, turso: number) => Math.max(i.vettori, turso);

function calcola(dimensioni: number, vettori: number, queryMese: number) {
  const maxQueryMese = Math.max(0, Math.floor(TETTO_INTERROGATE / Math.max(1, dimensioni)) - vettori);
  return {
    memorizzate: vettori * dimensioni,
    interrogateMese: queryMese > 0 ? (queryMese + vettori) * dimensioni : 0,
    maxQueryMese,
  };
}

async function riepilogoSicuro() {
  try {
    return await riepilogoIndice(getDb());
  } catch {
    return { generazione: null, completataIl: null, documenti: 0, vettori: 0 };
  }
}

export async function statoVectorize(): Promise<StatoVectorize> {
  const base: StatoVectorize = {
    configurato: configurato(),
    consentito: false,
    motivo: "",
    vettori: 0,
    dimensioni: 0,
    dimensioniModello: EMBEDDING_DIMS,
    modello: EMBEDDING_MODEL,
    memorizzate: 0,
    tettoMemorizzate: TETTO_MEMORIZZATE,
    interrogateMese: 0,
    tettoInterrogate: TETTO_INTERROGATE,
    queryMese: 0,
    maxQueryMese: 0,
    bloccateMese: 0,
    oltreQuotaConsentito: oltreQuotaConsentito(),
    indice: { pronto: false, documenti: 0, vettori: 0, completataIl: null },
  };
  if (!base.configurato) return { ...base, motivo: "Vectorize non configurato." };
  const [i, r] = await Promise.all([leggiInfo(), riepilogoSicuro()]);
  const indicePronto = r.generazione === generazioneCorrente() && !!r.completataIl;
  base.indice = { pronto: indicePronto, documenti: r.documenti, vettori: r.vettori, completataIl: r.completataIl };
  let queryMese = 0;
  let bloccateMese = 0;
  try {
    const db = getDb();
    if (await assicura(db)) {
      const rs = await db.execute({ sql: `SELECT query, bloccate FROM vectorize_uso WHERE mese = ?`, args: [meseUtc()] });
      queryMese = Number(rs.rows[0]?.query ?? 0);
      bloccateMese = Number(rs.rows[0]?.bloccate ?? 0);
    }
  } catch {
    /* contatore non leggibile */
  }
  if (!i) return { ...base, queryMese, bloccateMese, motivo: `Informazioni sull'indice non disponibili (${erroreInfo || "errore"}): ricerca semantica sospesa per prudenza.` };
  const vettori = vettoriDi(i, r.vettori);
  const c = calcola(i.dimensioni, vettori, queryMese);
  const stato = { ...base, dimensioni: i.dimensioni, vettori, ...c, queryMese, bloccateMese };
  if (i.dimensioni !== EMBEDDING_DIMS) {
    return {
      ...stato,
      motivo: `L'indice ha vettori da ${i.dimensioni} dimensioni, il modello di embedding ne produce ${EMBEDDING_DIMS}: serve la ricostruzione (DEPLOY.md, «Ricostruzione di Vectorize»). Si usa la ricerca testuale.`,
    };
  }
  if (stato.oltreQuotaConsentito) return { ...stato, consentito: true, motivo: "Guardiano disattivato (VECTORIZE_OLTRE_QUOTA=1)." };
  if (c.memorizzate > TETTO_MEMORIZZATE) {
    return { ...stato, motivo: `L'indice ha ${(c.memorizzate / 1e6).toFixed(1)} milioni di dimensioni memorizzate, oltre il tetto di ${TETTO_MEMORIZZATE / 1e6} milioni: ricerca semantica sospesa.` };
  }
  if (!indicePronto) {
    return {
      ...stato,
      motivo: `Ricostruzione dell'indice in corso (${r.documenti.toLocaleString("it-IT")} documenti, ${r.vettori.toLocaleString("it-IT")} passaggi): fino al termine si usa la ricerca testuale.`,
    };
  }
  if (c.maxQueryMese <= queryMese) {
    return { ...stato, motivo: `Tetto mensile di ${TETTO_INTERROGATE / 1e6} milioni di dimensioni interrogate raggiunto: fino al primo del mese si usa la ricerca testuale.` };
  }
  return { ...stato, consentito: true, motivo: `Attiva entro le quote (${queryMese.toLocaleString("it-IT")}/${c.maxQueryMese.toLocaleString("it-IT")} query questo mese).` };
}

/** Riserva una query Vectorize per il mese in corso; false = non interrogare. */
export async function prenotaQueryVectorize(): Promise<boolean> {
  if (!configurato()) return false;
  const i = await leggiInfo();
  if (!i || i.dimensioni !== EMBEDDING_DIMS) return false;
  if (oltreQuotaConsentito()) return true;
  const r = await riepilogoSicuro();
  if (r.generazione !== generazioneCorrente() || !r.completataIl) return false;
  const vettori = vettoriDi(i, r.vettori);
  if (vettori * i.dimensioni > TETTO_MEMORIZZATE) return false;
  const { maxQueryMese } = calcola(i.dimensioni, vettori, 0);
  let db: Client;
  try {
    db = getDb();
  } catch {
    return false;
  }
  if (!(await assicura(db))) return false;
  const mese = meseUtc();
  try {
    const rs = await db.batch(
      [
        { sql: `INSERT INTO vectorize_uso (mese) VALUES (?) ON CONFLICT(mese) DO NOTHING`, args: [mese] },
        {
          sql: `UPDATE vectorize_uso SET query = query + 1, aggiornato_il = ? WHERE mese = ? AND query + 1 <= ? RETURNING query`,
          args: [new Date().toISOString(), mese, maxQueryMese],
        },
      ],
      "write"
    );
    if (rs[1].rows.length > 0) return true;
    db.execute({ sql: `UPDATE vectorize_uso SET bloccate = bloccate + 1 WHERE mese = ?`, args: [mese] }).catch(() => undefined);
    return false;
  } catch {
    return false;
  }
}

/**
 * Si possono aggiungere `n` vettori restando sotto il tetto delle dimensioni
 * memorizzate? `vettoriNoti` = vettori gia' caricati secondo Turso.
 */
export async function spazioPerNuoviVettori(n: number, vettoriNoti = 0): Promise<{ ok: boolean; motivo: string }> {
  if (!configurato()) return { ok: false, motivo: "Vectorize non configurato." };
  const i = await leggiInfo(true);
  if (!i) return { ok: false, motivo: `indice non verificabile (${erroreInfo || "errore"})` };
  if (i.dimensioni !== EMBEDDING_DIMS) return { ok: false, motivo: `l'indice ha ${i.dimensioni} dimensioni, il modello ${EMBEDDING_DIMS}: serve la ricostruzione` };
  if (oltreQuotaConsentito()) return { ok: true, motivo: "" };
  const dopo = (vettoriDi(i, vettoriNoti) + n) * i.dimensioni;
  if (dopo > TETTO_MEMORIZZATE) {
    return {
      ok: false,
      motivo: `con altri ${n} passaggi l'indice supererebbe il tetto di ${TETTO_MEMORIZZATE / 1e6} milioni di dimensioni memorizzate`,
    };
  }
  return { ok: true, motivo: "" };
}

/** Solo per i test. */
export function _azzeraPerTest(): void {
  info = null;
  erroreInfo = "";
  pronto = null;
}
