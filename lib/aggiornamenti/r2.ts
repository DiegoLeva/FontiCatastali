import type { Client } from "@libsql/client";
import { AwsClient } from "aws4fetch";

/**
 * Archivio stabile dei PDF importati su Cloudflare R2 (API S3).
 *
 * Si attiva SOLO se sono presenti le variabili R2_* (altrimenti non fa nulla
 * e non rompe nulla). Ogni PDF scaricato dall'Agenzia viene copiato una volta
 * sola; l'URL/chiave restano nel DB come ripiego permanente se l'AdE sposta o
 * cancella il file. Per restare GRATIS: tetto di spazio (R2_MAX_GB, default 2,
 * mai oltre 8: il bucket ospita anche i PDF del corpus, ~1 GB, e i 10 GB
 * inclusi non vanno superati) e di scritture al mese (1 milione incluse,
 * qui al massimo 20.000).
 *
 *   R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY  token R2 "Object Read & Write"
 *   R2_BUCKET                               es. fonticatastali-docs
 *   R2_ACCOUNT_ID                           default CF_ACCOUNT_ID
 *   R2_URL_PUBBLICO                         base pubblica del bucket (opzionale)
 *   R2_PREFISSO                             default "aggiornamenti"
 */

const GB = 1024 ** 3;
const MAX_BYTE = Math.min(8, Math.max(0.1, Number(process.env.R2_MAX_GB || 2))) * GB;
const MAX_SCRITTURE_MESE = 20_000;

export function r2Configurato(): boolean {
  return !!(process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET && (process.env.R2_ACCOUNT_ID || process.env.CF_ACCOUNT_ID));
}

const DDL = [
  `CREATE TABLE IF NOT EXISTS archivio_pdf (
     url TEXT PRIMARY KEY,
     doc_id INTEGER,
     chiave TEXT NOT NULL,
     url_pubblico TEXT,
     byte INTEGER NOT NULL,
     sha256 TEXT,
     stato TEXT NOT NULL,
     caricato_il TEXT NOT NULL,
     mese TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_archivio_pdf_doc ON archivio_pdf(doc_id)`,
];

let pronto: Promise<boolean> | null = null;
async function assicura(db: Client): Promise<boolean> {
  if (!pronto) {
    pronto = db
      .batch(DDL, "write")
      .then(() => true)
      .catch(() => {
        pronto = null;
        return false;
      });
  }
  return pronto;
}

/** Chiave leggibile e sicura: aggiornamenti/2026/Ris. 42 - Oggetto.pdf */
export function chiaveArchivio(anno: number | null, nome: string): string {
  const prefisso = (process.env.R2_PREFISSO || "aggiornamenti").replace(/^\/+|\/+$/g, "");
  const pulito = nome
    .normalize("NFC")
    .replace(/[\\/:*?"<>|#%{}^~[\]`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
  return `${prefisso}/${anno || "s.d."}/${pulito || "documento"}.pdf`;
}

const urlPubblico = (chiave: string) => {
  const base = (process.env.R2_URL_PUBBLICO || "").replace(/\/+$/, "");
  return base ? `${base}/${chiave.split("/").map(encodeURIComponent).join("/")}` : null;
};

export interface EsitoArchivio {
  ok: boolean;
  chiave?: string;
  urlPubblico?: string | null;
  motivo?: string;
}

/** Copia il PDF su R2 (una volta sola per URL). Mai un'eccezione: esito leggibile. */
export async function archiviaPdf(
  db: Client,
  v: { url: string; pdf: Uint8Array; sha256?: string | null; anno: number | null; nome: string; docId?: number | null; stato: "importato" | "needs_ocr" }
): Promise<EsitoArchivio> {
  if (!r2Configurato()) return { ok: false, motivo: "R2 non configurato" };
  if (!(await assicura(db))) return { ok: false, motivo: "registro dell'archivio non disponibile" };
  try {
    const gia = await db.execute({ sql: `SELECT chiave, url_pubblico FROM archivio_pdf WHERE url = ?`, args: [v.url] });
    if (gia.rows.length) {
      if (v.docId) await db.execute({ sql: `UPDATE archivio_pdf SET doc_id = ?, stato = ? WHERE url = ?`, args: [v.docId, v.stato, v.url] });
      return { ok: true, chiave: String(gia.rows[0].chiave), urlPubblico: gia.rows[0].url_pubblico ? String(gia.rows[0].url_pubblico) : null };
    }
    const mese = new Date().toISOString().slice(0, 7);
    const uso = await db.execute({ sql: `SELECT COALESCE(SUM(byte), 0) AS byte, SUM(CASE WHEN mese = ? THEN 1 ELSE 0 END) AS scritture FROM archivio_pdf`, args: [mese] });
    const occupati = Number(uso.rows[0]?.byte ?? 0);
    const scritture = Number(uso.rows[0]?.scritture ?? 0);
    if (occupati + v.pdf.length > MAX_BYTE) return { ok: false, motivo: `spazio dell'archivio esaurito (${(occupati / GB).toFixed(2)} GB su ${(MAX_BYTE / GB).toFixed(1)})` };
    if (scritture >= MAX_SCRITTURE_MESE) return { ok: false, motivo: "tetto mensile di scritture su R2 raggiunto" };

    const account = process.env.R2_ACCOUNT_ID || process.env.CF_ACCOUNT_ID!;
    const bucket = process.env.R2_BUCKET!;
    const chiave = chiaveArchivio(v.anno, v.nome);
    const client = new AwsClient({ accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!, service: "s3", region: "auto" });
    const res = await client.fetch(`https://${account}.r2.cloudflarestorage.com/${bucket}/${chiave.split("/").map(encodeURIComponent).join("/")}`, {
      method: "PUT",
      body: v.pdf as unknown as BodyInit,
      headers: { "Content-Type": "application/pdf" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return { ok: false, motivo: `caricamento su R2 non riuscito (HTTP ${res.status})` };
    const pubblico = urlPubblico(chiave);
    await db.execute({
      sql: `INSERT INTO archivio_pdf (url, doc_id, chiave, url_pubblico, byte, sha256, stato, caricato_il, mese) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [v.url, v.docId ?? null, chiave, pubblico, v.pdf.length, v.sha256 ?? null, v.stato, new Date().toISOString(), mese],
    });
    return { ok: true, chiave, urlPubblico: pubblico };
  } catch (err) {
    return { ok: false, motivo: `archivio R2: ${(err as Error).message.slice(0, 120)}` };
  }
}

/** Copia d'archivio di un documento del corpus (per il lettore e la pagina di stato). */
export async function archivioDi(db: Client, docId: number): Promise<{ urlPubblico: string | null; chiave: string } | null> {
  try {
    const rs = await db.execute({ sql: `SELECT chiave, url_pubblico FROM archivio_pdf WHERE doc_id = ? LIMIT 1`, args: [docId] });
    return rs.rows.length ? { chiave: String(rs.rows[0].chiave), urlPubblico: rs.rows[0].url_pubblico ? String(rs.rows[0].url_pubblico) : null } : null;
  } catch {
    return null; // tabella non ancora creata
  }
}

/** Uso dell'archivio (spazio e scritture del mese) per la pagina di stato. */
export async function usoArchivio(db: Client): Promise<{ configurato: boolean; documenti: number; byte: number; maxByte: number; scrittureMese: number } | null> {
  const configurato = r2Configurato();
  try {
    const mese = new Date().toISOString().slice(0, 7);
    const rs = await db.execute({ sql: `SELECT COUNT(*) AS n, COALESCE(SUM(byte), 0) AS byte, SUM(CASE WHEN mese = ? THEN 1 ELSE 0 END) AS scritture FROM archivio_pdf`, args: [mese] });
    return { configurato, documenti: Number(rs.rows[0]?.n ?? 0), byte: Number(rs.rows[0]?.byte ?? 0), maxByte: MAX_BYTE, scrittureMese: Number(rs.rows[0]?.scritture ?? 0) };
  } catch {
    return { configurato, documenti: 0, byte: 0, maxByte: MAX_BYTE, scrittureMese: 0 };
  }
}
