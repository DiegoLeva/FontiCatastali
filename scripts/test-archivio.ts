/**
 * Prova LOCALE dell'archivio PDF su R2 e della coda OCR (senza rete).
 *
 *   npx tsx scripts/test-archivio.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fc-r2-")), "test.db");
process.env.TURSO_DATABASE_URL = `file:${dbFile}`;

let fallimenti = 0;
const verifica = (c: unknown, m: string) => {
  console.log(`  ${c ? "✓" : "✗"} ${m}`);
  if (!c) fallimenti++;
};

const put: Array<{ url: string; auth: string; tipo: string }> = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  if (req.method === "PUT") put.push({ url: req.url, auth: req.headers.get("authorization") ?? "", tipo: req.headers.get("content-type") ?? "" });
  return new Response("", { status: 200 });
}) as typeof fetch;

async function main() {
  const r2 = await import("../lib/aggiornamenti/r2");
  const { getDb } = await import("../lib/db");
  const db = getDb();
  await db.execute(`CREATE TABLE documenti (id INTEGER PRIMARY KEY, cartella_origine TEXT, nuovo_nome_file TEXT, anno INTEGER, titolo TEXT, tema TEXT, testo_estratto TEXT)`);
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);

  console.log("\n# Senza variabili R2");
  const spento = await r2.archiviaPdf(db, { url: "https://ade.example/a.pdf", pdf, anno: 2026, nome: "Ris. 42 - Oggetto", stato: "importato" });
  verifica(!r2.r2Configurato() && !spento.ok && put.length === 0, "archivio disattivato: nessuna chiamata, nessun errore");

  console.log("\n# Con R2 configurato");
  process.env.R2_ACCESS_KEY_ID = "chiave-prova";
  process.env.R2_SECRET_ACCESS_KEY = "segreto-prova";
  process.env.R2_BUCKET = "fonticatastali-docs";
  process.env.R2_ACCOUNT_ID = "acc";
  process.env.R2_URL_PUBBLICO = "https://pub-esempio.r2.dev";
  const a = await r2.archiviaPdf(db, { url: "https://ade.example/a.pdf", pdf, sha256: "abc", anno: 2026, nome: "Ris. 42 - Riserva di proprietà / voltura", docId: 7, stato: "importato" });
  verifica(a.ok && put.length === 1, "PDF caricato con una PUT");
  verifica(put[0]?.url === "https://acc.r2.cloudflarestorage.com/fonticatastali-docs/aggiornamenti/2026/Ris.%2042%20-%20Riserva%20di%20propriet%C3%A0%20voltura.pdf", `chiave leggibile e sicura (${put[0]?.url})`);
  verifica(put[0]?.auth.startsWith("AWS4-HMAC-SHA256 Credential=chiave-prova/") && put[0]?.tipo === "application/pdf", "richiesta firmata AWS4 (API S3 di R2)");
  verifica(a.urlPubblico === "https://pub-esempio.r2.dev/aggiornamenti/2026/Ris.%2042%20-%20Riserva%20di%20propriet%C3%A0%20voltura.pdf", "URL pubblico di ripiego salvato");
  const b = await r2.archiviaPdf(db, { url: "https://ade.example/a.pdf", pdf, anno: 2026, nome: "altro nome", stato: "importato" });
  verifica(b.ok && put.length === 1, "stesso atto: nessun secondo caricamento");
  verifica((await r2.archivioDi(db, 7))?.urlPubblico === a.urlPubblico, "copia d'archivio collegata al documento");

  console.log("\n# Tetto di spazio (gratis entro i 10 GB)");
  await db.execute({ sql: `INSERT INTO archivio_pdf (url, chiave, byte, stato, caricato_il, mese) VALUES ('x', 'x', ?, 'importato', '2026-11-01', '2026-11')`, args: [2 * 1024 ** 3] });
  const pieno = await r2.archiviaPdf(db, { url: "https://ade.example/b.pdf", pdf, anno: 2026, nome: "Prov. 1", stato: "importato" });
  verifica(!pieno.ok && /spazio/.test(pieno.motivo ?? "") && put.length === 1, `oltre il tetto (2 GB di default): niente caricamento (${pieno.motivo})`);

  console.log("\n# Coda OCR nella pagina di stato");
  const { assicuraSchema, registraVoce } = await import("../lib/aggiornamenti/archivio");
  await assicuraSchema(db);
  await db.execute(`INSERT INTO aggiornamenti_esecuzioni (avviata_il, innesco, esito) VALUES ('2026-11-30T05:00:00Z', 'cron', 'ok')`).catch(() => undefined);
  await registraVoce(db, { url: "https://ade.example/scan.pdf", fonte: "ade-provvedimenti", tipo: "provvedimento", titoloFonte: "Provvedimento scansionato", oggetto: "Volture", stato: "needs_ocr", motivo: "PDF scansionato senza testo: in coda per l'OCR locale" });
  await db.execute({ sql: `INSERT INTO archivio_pdf (url, chiave, url_pubblico, byte, stato, caricato_il, mese) VALUES (?, 'k', 'https://pub-esempio.r2.dev/k.pdf', 10, 'needs_ocr', '2026-11-30', '2026-11')`, args: ["https://ade.example/scan.pdf"] });
  const { leggiStato } = await import("../lib/aggiornamenti/stato");
  const stato = await leggiStato();
  const v = stato.voci.find((x) => x.url === "https://ade.example/scan.pdf");
  verifica(v?.stato === "needs_ocr" && v.urlArchivio === "https://pub-esempio.r2.dev/k.pdf", "atto «da OCR» elencato con la copia d'archivio");
  verifica(stato.avvisi.some((x) => /OCR/.test(x)), "avviso con l'istruzione per l'OCR locale");

  console.log(fallimenti === 0 ? "\nTUTTI I CONTROLLI SUPERATI" : `\n${fallimenti} CONTROLLI FALLITI`);
  process.exit(fallimenti === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
