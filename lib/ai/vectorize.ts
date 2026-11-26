import type { Client } from "@libsql/client";
import { getDb } from "@/lib/db";
import { infoIndice } from "@/lib/cloudflare";

/**
 * Guardiano delle quote Vectorize (obiettivo: 0 € extra).
 *
 * Workers Paid include ogni mese 50 milioni di dimensioni INTERROGATE e 10
 * milioni di dimensioni MEMORIZZATE. Per Cloudflare le interrogate valgono
 * (query del mese + vettori memorizzati) × dimensioni: con un indice grande
 * anche UNA sola query nel mese fa superare la quota. Quindi:
 *
 *   - una query parte solo se (vettori + query del mese + 1) × dimensioni
 *     resta sotto il 90% dei 50M (contatore mensile atomico su Turso);
 *   - un upsert parte solo se le memorizzate restano sotto il 90% dei 10M;
 *   - se le informazioni sull'indice non sono verificabili non si interroga.
 *
 * VECTORIZE_OLTRE_QUOTA=1 disattiva il guardiano (scelta consapevole di
 * accettare l'eventuale addebito). Lo stato e' visibile su /aggiornamenti.
 */

export const INCLUSE_INTERROGATE = 50_000_000;
export const INCLUSE_MEMORIZZATE = 10_000_000;
const QUOTA_UTILE = 0.9;
const CACHE_INFO_MS = 60 * 60_000;

const meseUtc = (d = new Date()) => d.toISOString().slice(0, 7);
const oltreQuotaConsentito = () => process.env.VECTORIZE_OLTRE_QUOTA === "1";
const configurato = () => !!(process.env.CF_ACCOUNT_ID && process.env.CF_API_TOKEN && process.env.CF_VECTORIZE_INDEX);

let info: { il: number; dimensioni: number; vettori: number } | null = null;
let erroreInfo = "";

async function leggiInfo(forza = false): Promise<{ dimensioni: number; vettori: number } | null> {
  if (!forza && info && Date.now() - info.il < CACHE_INFO_MS) return info;
  try {
    const i = await infoIndice();
    if (!i.dimensioni) throw new Error("dimensioni non indicate");
    info = { il: Date.now(), ...i };
    erroreInfo = "";
    return info;
  } catch (err) {
    erroreInfo = (err as Error).message.slice(0, 160);
    return null;
  }
}

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
  memorizzate: number;
  interrogateMese: number;
  queryMese: number;
  maxQueryMese: number;
  bloccateMese: number;
  oltreQuotaConsentito: boolean;
}

function calcola(i: { dimensioni: number; vettori: number }, queryMese: number) {
  const maxQueryMese = Math.max(0, Math.floor((QUOTA_UTILE * INCLUSE_INTERROGATE) / i.dimensioni) - i.vettori);
  return {
    memorizzate: i.vettori * i.dimensioni,
    interrogateMese: queryMese > 0 ? (queryMese + i.vettori) * i.dimensioni : 0,
    maxQueryMese,
  };
}

export async function statoVectorize(): Promise<StatoVectorize> {
  const base: StatoVectorize = {
    configurato: configurato(),
    consentito: false,
    motivo: "",
    vettori: 0,
    dimensioni: 0,
    memorizzate: 0,
    interrogateMese: 0,
    queryMese: 0,
    maxQueryMese: 0,
    bloccateMese: 0,
    oltreQuotaConsentito: oltreQuotaConsentito(),
  };
  if (!base.configurato) return { ...base, motivo: "Vectorize non configurato." };
  const i = await leggiInfo();
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
  const c = calcola(i, queryMese);
  const stato = { ...base, ...i, ...c, queryMese, bloccateMese };
  if (stato.oltreQuotaConsentito) return { ...stato, consentito: true, motivo: "Guardiano disattivato (VECTORIZE_OLTRE_QUOTA=1)." };
  if (c.maxQueryMese <= queryMese) {
    return {
      ...stato,
      motivo: `L'indice ha ${i.vettori.toLocaleString("it-IT")} vettori × ${i.dimensioni} dimensioni: anche una sola query nel mese porterebbe le dimensioni interrogate oltre i ${INCLUSE_INTERROGATE / 1e6} milioni inclusi. Ricerca semantica sospesa (si usa la ricerca testuale).`,
    };
  }
  return { ...stato, consentito: true, motivo: `Entro le quote incluse (${queryMese}/${c.maxQueryMese} query questo mese).` };
}

/** Riserva una query Vectorize per il mese in corso; false = non interrogare. */
export async function prenotaQueryVectorize(): Promise<boolean> {
  if (!configurato()) return false;
  if (oltreQuotaConsentito()) return true;
  const i = await leggiInfo();
  if (!i) return false;
  const { maxQueryMese } = calcola(i, 0);
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

/** Si possono aggiungere `n` vettori restando sotto la quota di memorizzazione? */
export async function spazioPerNuoviVettori(n: number): Promise<{ ok: boolean; motivo: string }> {
  if (!configurato()) return { ok: false, motivo: "Vectorize non configurato." };
  if (oltreQuotaConsentito()) return { ok: true, motivo: "" };
  const i = await leggiInfo(true);
  if (!i) return { ok: false, motivo: `indice non verificabile (${erroreInfo || "errore"})` };
  const dopo = (i.vettori + n) * i.dimensioni;
  if (dopo > QUOTA_UTILE * INCLUSE_MEMORIZZATE) {
    return {
      ok: false,
      motivo: `l'indice ha già ${(i.vettori * i.dimensioni / 1e6).toFixed(1)} milioni di dimensioni memorizzate (incluse: ${INCLUSE_MEMORIZZATE / 1e6} milioni)`,
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
