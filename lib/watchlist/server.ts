import type { Client } from "@libsql/client";
import { espandiArgomento, normalizza, unioneFts, chiaveArgomento } from "@/lib/studio/espansione";
import { docUrl } from "@/lib/docs";
import { dossierInCache, segnalaNuovaNormativa } from "@/lib/studio/cache";

/**
 * Watchlist degli argomenti (senza account): ogni browser tiene i suoi
 * argomenti in localStorage; il server conserva solo un registro ANONIMO
 * (argomento + quanti lo seguono) per sapere cosa confrontare con i nuovi
 * atti del cron. Il confronto usa la stessa espansione deterministica dello
 * Studio (radici, tesauro, codici di categoria verificati): nessun modello AI.
 */

const DDL = [
  `CREATE TABLE IF NOT EXISTS watchlist_argomenti (
     chiave TEXT PRIMARY KEY,
     argomento TEXT NOT NULL,
     seguito_da INTEGER NOT NULL DEFAULT 0,
     creato_il TEXT NOT NULL,
     ultimo_il TEXT NOT NULL
   )`,
];

let pronto: Promise<boolean> | null = null;
async function assicura(db: Client): Promise<boolean> {
  if (!pronto) {
    pronto = db
      .batch(DDL, "write")
      .then(() => true)
      .catch((err) => {
        console.warn("[watchlist] registro non disponibile:", (err as Error).message);
        pronto = null;
        return false;
      });
  }
  return pronto;
}

/** Argomento valido: 2-80 caratteri con almeno un termine ricercabile. */
export function argomentoValido(grezzo: unknown): string | null {
  const a = String(grezzo ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  // Almeno un termine di 2 caratteri, oppure un codice di categoria (F/3, D/1).
  if (a.length < 2 || !/[a-z0-9]{2,}|(?<![a-z0-9])[a-f]\s*\/\s*\d/.test(normalizza(a))) return null;
  return a;
}

export async function registraArgomento(db: Client, argomento: string, azione: "segui" | "smetti"): Promise<void> {
  if (!(await assicura(db))) return;
  const chiave = chiaveArgomento(argomento);
  const ora = new Date().toISOString();
  if (azione === "segui") {
    await db.execute({
      sql: `INSERT INTO watchlist_argomenti (chiave, argomento, seguito_da, creato_il, ultimo_il) VALUES (?, ?, 1, ?, ?)
            ON CONFLICT(chiave) DO UPDATE SET seguito_da = seguito_da + 1, ultimo_il = excluded.ultimo_il`,
      args: [chiave, argomento, ora, ora],
    });
  } else {
    await db.execute({ sql: `UPDATE watchlist_argomenti SET seguito_da = MAX(0, seguito_da - 1), ultimo_il = ? WHERE chiave = ?`, args: [ora, chiave] });
  }
}

export async function argomentiRegistrati(db: Client): Promise<Array<{ chiave: string; argomento: string; seguitoDa: number }>> {
  if (!(await assicura(db))) return [];
  const rs = await db.execute(`SELECT chiave, argomento, seguito_da FROM watchlist_argomenti WHERE seguito_da > 0 ORDER BY seguito_da DESC LIMIT 500`);
  return rs.rows.map((r) => ({ chiave: String(r.chiave), argomento: String(r.argomento), seguitoDa: Number(r.seguito_da ?? 0) }));
}

/* -------------------------------------------------------------------------- */
/* Corrispondenze argomento <-> documenti                                      */
/* -------------------------------------------------------------------------- */

const segnaposti = (n: number) => Array.from({ length: n }, () => "?").join(",");

/**
 * Quali documenti fra `ids` riguardano `argomento`? FTS sull'unione dei
 * concetti principali; per i codici di categoria (F/3, D/1...) la barra va
 * verificata sul testo ("lettera f) 3." non e' la categoria F/3).
 */
export async function documentiPerArgomento(db: Client, argomento: string, ids: number[]): Promise<number[]> {
  if (!ids.length) return [];
  const piano = espandiArgomento(argomento);
  const concetti = piano.concetti.filter((c) => c.peso >= 0.6);
  const fts = unioneFts(concetti);
  if (!fts) return [];
  const rs = await db.execute({
    sql: `SELECT rowid AS id FROM documenti_fts WHERE documenti_fts MATCH ? AND rowid IN (${segnaposti(ids.length)})`,
    args: [fts, ...ids],
  });
  let trovati = rs.rows.map((r) => Number(r.id));
  const codici = concetti.filter((c) => c.codice);
  const altri = concetti.filter((c) => !c.codice);
  if (codici.length && trovati.length) {
    // Documento trovato solo grazie a un codice: si verifica la barra sul testo.
    const testi = await db.execute({
      sql: `SELECT id, substr(titolo || ' ' || testo_estratto, 1, 200000) AS t FROM documenti WHERE id IN (${segnaposti(trovati.length)})`,
      args: trovati,
    });
    const ok = new Set<number>();
    for (const r of testi.rows) {
      const t = String(r.t ?? "");
      const perCodice = codici.some((c) => new RegExp(c.regex, "iu").test(t));
      const perAltro = altri.some((c) => new RegExp(c.regex, "iu").test(t));
      if (perCodice || perAltro) ok.add(Number(r.id));
    }
    trovati = trovati.filter((id) => ok.has(id));
  }
  return trovati;
}

export interface AttoNuovo {
  id: number;
  titolo: string;
  anno: string;
  cartella: string;
  url: string;
  importatoIl: string;
}

/** Atti importati dal cron dopo `dal` (ISO), dal piu' recente. */
export async function attiImportatiDal(db: Client, dal: string, limite = 200): Promise<AttoNuovo[]> {
  try {
    const rs = await db.execute({
      sql: `SELECT d.id, d.titolo, d.anno, d.cartella_origine AS cartella, d.nuovo_nome_file AS nome, v.importato_il
            FROM aggiornamenti_voci v JOIN documenti d ON d.id = v.doc_id
            WHERE v.stato = 'importato' AND v.importato_il >= ?
            ORDER BY v.importato_il DESC LIMIT ?`,
      args: [dal, limite],
    });
    return rs.rows.map((r) => ({
      id: Number(r.id),
      titolo: String(r.titolo ?? ""),
      anno: String(r.anno ?? ""),
      cartella: String(r.cartella ?? ""),
      url: docUrl(String(r.cartella ?? ""), String(r.nome ?? "")),
      importatoIl: String(r.importato_il ?? ""),
    }));
  } catch {
    return []; // registro del cron non ancora creato
  }
}

/** Novita' per ciascun argomento (in ordine) dagli atti importati dopo `dal`. */
export async function novitaPerArgomenti(db: Client, argomenti: string[], dal: string): Promise<Array<{ argomento: string; atti: AttoNuovo[] }>> {
  const nuovi = await attiImportatiDal(db, dal);
  const ids = nuovi.map((a) => a.id);
  const perId = new Map(nuovi.map((a) => [a.id, a]));
  const out: Array<{ argomento: string; atti: AttoNuovo[] }> = [];
  for (const argomento of argomenti) {
    const trovati = ids.length ? await documentiPerArgomento(db, argomento, ids) : [];
    out.push({ argomento, atti: trovati.map((id) => perId.get(id)!).filter(Boolean) });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Dopo il cron: argomenti seguiti e dossier in cache                          */
/* -------------------------------------------------------------------------- */

export interface EsitoWatchlist {
  argomenti: Array<{ argomento: string; seguitoDa: number; atti: Array<{ id: number; titolo: string }> }>;
  dossierSegnalati: Array<{ argomento: string; atti: number }>;
}

export async function confrontaNuoviAtti(db: Client, idImportati: number[]): Promise<EsitoWatchlist> {
  const esito: EsitoWatchlist = { argomenti: [], dossierSegnalati: [] };
  if (!idImportati.length) return esito;
  const titoli = new Map<number, string>();
  const rs = await db.execute({ sql: `SELECT id, titolo FROM documenti WHERE id IN (${segnaposti(idImportati.length)})`, args: idImportati });
  for (const r of rs.rows) titoli.set(Number(r.id), String(r.titolo ?? ""));

  for (const a of await argomentiRegistrati(db)) {
    const trovati = await documentiPerArgomento(db, a.argomento, idImportati);
    if (trovati.length) esito.argomenti.push({ argomento: a.argomento, seguitoDa: a.seguitoDa, atti: trovati.map((id) => ({ id, titolo: titoli.get(id) ?? "" })) });
  }
  for (const d of await dossierInCache(db)) {
    const nuovi = idImportati.filter((id) => id > d.maxId);
    if (!nuovi.length) continue;
    const trovati = await documentiPerArgomento(db, d.argomento, nuovi);
    if (trovati.length) {
      await segnalaNuovaNormativa(db, d.chiave, trovati.length);
      esito.dossierSegnalati.push({ argomento: d.argomento, atti: trovati.length });
    }
  }
  return esito;
}
