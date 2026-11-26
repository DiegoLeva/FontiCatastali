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

async function assicura(db: Client): Promise<boolean> {
  if (!pronto) {
    pronto = db
      .batch(DDL, "write")
      .then(() => true)
      .catch((err) => {
        console.warn("[studio] cache non disponibile:", (err as Error).message);
        pronto = null;
        return false;
      });
  }
  return pronto;
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
    const rs = await db.execute({ sql: `SELECT payload FROM studio_dossier WHERE chiave = ?`, args: [chiave] });
    if (!rs.rows.length) return null;
    const d = JSON.parse(String(rs.rows[0].payload)) as Dossier;
    if (d?.versione !== 1) return null;
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
      sql: `INSERT INTO studio_dossier (chiave, argomento, creato_il, max_id, fonti, analizzate, durata_ms, modello, payload)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(chiave) DO UPDATE SET argomento = excluded.argomento, creato_il = excluded.creato_il,
              max_id = excluded.max_id, fonti = excluded.fonti, analizzate = excluded.analizzate,
              durata_ms = excluded.durata_ms, modello = excluded.modello, payload = excluded.payload`,
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
  const rs = await db.execute({
    sql: `SELECT chiave, argomento, creato_il, fonti, analizzate FROM studio_dossier ORDER BY creato_il DESC LIMIT ?`,
    args: [limite],
  });
  return rs.rows.map((r) => ({
    chiave: String(r.chiave),
    argomento: String(r.argomento),
    creatoIl: String(r.creato_il),
    fonti: Number(r.fonti ?? 0),
    analizzate: Number(r.analizzate ?? 0),
  }));
}

/**
 * Tetto globale di generazioni al giorno (protezione dei costi AI). Se il
 * contatore non e' scrivibile si lascia passare: decide il rate limit per IP.
 */
export async function consumaQuota(db: Client, massimo: number): Promise<{ ok: boolean; usate: number }> {
  if (!(await assicura(db))) return { ok: true, usate: 0 };
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
    return { ok: true, usate: 0 };
  }
}
