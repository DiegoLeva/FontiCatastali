import type { Client } from "@libsql/client";
import type { Dossier, DossierRecente } from "./tipi";

/**
 * Cache dei dossier su Turso: un dossier costa decine di chiamate al modello,
 * quindi una volta generato si serve da qui (istantaneo e gratuito) finche'
 * l'utente non chiede "Rigenera". Se nel frattempo entrano nel corpus nuove
 * fonti pertinenti, l'interfaccia lo segnala (vedi nuoveFontiDopo).
 *
 * Tutto e' "best effort": se il token Turso fosse in sola lettura lo Studio
 * funziona comunque, semplicemente senza cache condivisa.
 */

const DDL = [
  `CREATE TABLE IF NOT EXISTS studio_dossier (
     chiave TEXT PRIMARY KEY,
     argomento TEXT NOT NULL,
     creato_il TEXT NOT NULL,
     max_id INTEGER NOT NULL,
     fonti INTEGER NOT NULL,
     analizzate INTEGER NOT NULL,
     durata_ms INTEGER,
     modello TEXT,
     letture INTEGER NOT NULL DEFAULT 0,
     payload TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_studio_creato ON studio_dossier(creato_il)`,
  `CREATE TABLE IF NOT EXISTS studio_generazioni (giorno TEXT PRIMARY KEY, n INTEGER NOT NULL)`,
];

let pronto: Promise<boolean> | null = null;

/** Colonne aggiunte dopo la prima versione (migrazione idempotente). */
const COLONNE_EXTRA: Array<[string, string]> = [
  ["nuove_fonti", "INTEGER"],
  ["segnalato_il", "TEXT"],
];

async function assicura(db: Client): Promise<boolean> {
  if (!pronto) {
    pronto = (async () => {
      await db.batch(DDL, "write");
      const info = await db.execute(`PRAGMA table_info(studio_dossier)`);
      const presenti = new Set(info.rows.map((r) => String(r.name)));
      for (const [nome, tipo] of COLONNE_EXTRA) {
        if (!presenti.has(nome)) await db.execute(`ALTER TABLE studio_dossier ADD COLUMN ${nome} ${tipo}`);
      }
      return true;
    })().catch((err) => {
      console.warn("[studio] cache non disponibile:", (err as Error).message);
      pronto = null;
      return false;
    });
  }
  return pronto;
}

/*
 * Dossier generati prima di un fix che ne altera il contenuto: si servono
 * ancora (con un avviso) ma si rigenerano alla prima apertura con budget.
 * Firma del bug dei codici di categoria (corretto il 26/11/2026): un concetto
 * con codice (F/3, D/1...) e 0 documenti in un dossier precedente al fix.
 */
const RE_CODICE = /(?<![A-Za-z0-9])[A-F]\/\d{1,2}(?!\d)/;
const FIX_CODICI = "2026-11-26T12:00:00.000Z";

export function motivoObsoleto(d: Pick<Dossier, "creatoIl" | "espansione">): string | undefined {
  if (d.creatoIl < FIX_CODICI && (d.espansione ?? []).some((c) => RE_CODICE.test(c.etichetta) && c.documenti === 0)) {
    return "generato prima della correzione sulla ricerca dei codici di categoria (es. F/3, D/1): mancano alcune fonti";
  }
  return undefined;
}

async function tabellaEsiste(db: Client): Promise<boolean> {
  try {
    const rs = await db.execute(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'studio_dossier'`);
    return rs.rows.length > 0;
  } catch {
    return false;
  }
}

export async function leggiCache(db: Client, chiave: string): Promise<Dossier | null> {
  if (!(await tabellaEsiste(db))) return null;
  try {
    await assicura(db);
    const rs = await db.execute({ sql: `SELECT payload, nuove_fonti, segnalato_il FROM studio_dossier WHERE chiave = ?`, args: [chiave] });
    if (!rs.rows.length) return null;
    const d = JSON.parse(String(rs.rows[0].payload)) as Dossier;
    if (d?.versione !== 1) return null;
    const obsoleto = motivoObsoleto(d);
    if (obsoleto) d.obsoleto = obsoleto;
    const nuove = Number(rs.rows[0].nuove_fonti ?? 0);
    if (nuove > 0) d.nuovaNormativa = { atti: nuove, segnalatoIl: String(rs.rows[0].segnalato_il ?? "") };
    db.execute({ sql: `UPDATE studio_dossier SET letture = letture + 1 WHERE chiave = ?`, args: [chiave] }).catch(() => undefined);
    return d;
  } catch (err) {
    console.warn("[studio] lettura cache non riuscita:", (err as Error).message);
    return null;
  }
}

export async function salvaCache(db: Client, d: Dossier): Promise<boolean> {
  if (!(await assicura(db))) return false;
  try {
    await db.execute({
      sql: `INSERT INTO studio_dossier (chiave, argomento, creato_il, max_id, fonti, analizzate, durata_ms, modello, payload, nuove_fonti, segnalato_il)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)
            ON CONFLICT(chiave) DO UPDATE SET argomento = excluded.argomento, creato_il = excluded.creato_il,
              max_id = excluded.max_id, fonti = excluded.fonti, analizzate = excluded.analizzate,
              durata_ms = excluded.durata_ms, modello = excluded.modello, payload = excluded.payload,
              nuove_fonti = 0, segnalato_il = NULL`,
      args: [
        d.chiave, d.argomento, d.creatoIl, d.versioneCorpus.maxId, d.statistiche.trovate,
        d.statistiche.analizzate, d.statistiche.durataMs, d.statistiche.modello, JSON.stringify(d),
      ],
    });
    return true;
  } catch (err) {
    console.warn("[studio] salvataggio cache non riuscito:", (err as Error).message);
    return false;
  }
}

export async function dossierRecenti(db: Client, limite = 12): Promise<DossierRecente[]> {
  if (!(await tabellaEsiste(db))) return [];
  await assicura(db);
  const rs = await db.execute({
    sql: `SELECT chiave, argomento, creato_il, fonti, analizzate, nuove_fonti,
                 json_extract(payload, '$.espansione') AS espansione
          FROM studio_dossier ORDER BY creato_il DESC LIMIT ?`,
    args: [limite],
  });
  return rs.rows.map((r) => {
    let espansione: Dossier["espansione"] = [];
    try {
      espansione = JSON.parse(String(r.espansione ?? "[]"));
    } catch {
      /* payload non leggibile */
    }
    const creatoIl = String(r.creato_il);
    return {
      chiave: String(r.chiave),
      argomento: String(r.argomento),
      creatoIl,
      fonti: Number(r.fonti ?? 0),
      analizzate: Number(r.analizzate ?? 0),
      ...(motivoObsoleto({ creatoIl, espansione }) ? { obsoleto: true } : {}),
      ...(Number(r.nuove_fonti ?? 0) > 0 ? { nuovaNormativa: Number(r.nuove_fonti) } : {}),
    };
  });
}

/** Il cron segnala ai dossier in cache i nuovi atti pertinenti entrati nel corpus. */
export async function segnalaNuovaNormativa(db: Client, chiave: string, atti: number): Promise<void> {
  if (atti <= 0 || !(await assicura(db))) return;
  await db.execute({
    sql: `UPDATE studio_dossier SET nuove_fonti = COALESCE(nuove_fonti, 0) + ?, segnalato_il = ? WHERE chiave = ?`,
    args: [atti, new Date().toISOString(), chiave],
  });
}

/** Chiavi e argomenti dei dossier in cache (per il confronto con i nuovi atti). */
export async function dossierInCache(db: Client): Promise<Array<{ chiave: string; argomento: string; maxId: number }>> {
  if (!(await tabellaEsiste(db))) return [];
  const rs = await db.execute(`SELECT chiave, argomento, max_id FROM studio_dossier`);
  return rs.rows.map((r) => ({ chiave: String(r.chiave), argomento: String(r.argomento), maxId: Number(r.max_id ?? 0) }));
}

/**
 * Tetto di NUOVE generazioni al giorno (UTC), oltre al budget di neuroni. Se
 * il contatore non e' scrivibile si nega (prudenza: niente spese al buio).
 */
export async function consumaQuota(db: Client, massimo: number): Promise<{ ok: boolean; usate: number }> {
  if (!(await assicura(db))) return { ok: false, usate: 0 };
  const giorno = new Date().toISOString().slice(0, 10);
  try {
    const rs = await db.execute({
      sql: `INSERT INTO studio_generazioni (giorno, n) VALUES (?, 1)
            ON CONFLICT(giorno) DO UPDATE SET n = n + 1 RETURNING n`,
      args: [giorno],
    });
    const usate = Number(rs.rows[0]?.n ?? 0);
    return { ok: usate <= massimo, usate };
  } catch {
    return { ok: false, usate: 0 };
  }
}

/** Nuove generazioni gia' avviate oggi (UTC). */
export async function generazioniOggi(db: Client): Promise<number> {
  if (!(await tabellaEsiste(db))) return 0;
  try {
    const rs = await db.execute({ sql: `SELECT n FROM studio_generazioni WHERE giorno = ?`, args: [new Date().toISOString().slice(0, 10)] });
    return Number(rs.rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}
