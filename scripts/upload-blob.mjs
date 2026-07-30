// =============================================================================
// Carica i documenti (Database_Normalizzato) su Vercel Blob mantenendo la
// struttura <Cartella>/<file>, cosi' l'app li apre via NEXT_PUBLIC_DOCS_BASE_URL.
//
// Uso (dalla cartella fonticatastali), col token dal tuo Vercel
// (Dashboard -> Storage -> Blob -> ".env.local" / token):
//   $env:BLOB_READ_WRITE_TOKEN="vercel_blob_rw_xxx"; node scripts/upload-blob.mjs   (PowerShell)
//   BLOB_READ_WRITE_TOKEN=vercel_blob_rw_xxx node scripts/upload-blob.mjs           (bash)
//
// A fine upload stampa la BASE URL da mettere in NEXT_PUBLIC_DOCS_BASE_URL.
// =============================================================================
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { put } from "@vercel/blob";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..");
const SRC = join(APP, "..", "Database_Normalizzato");
const EXT = new Set([".pdf", ".docx", ".xlsx"]);
const CONCURRENCY = 6;

const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) {
  console.error("ERRORE: manca BLOB_READ_WRITE_TOKEN nell'ambiente.");
  process.exit(1);
}

const CONTENT_TYPES = {
  ".pdf": "application/pdf",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx":
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

async function main() {
  const files = [];
  for await (const f of walk(SRC)) {
    if (EXT.has(extname(f).toLowerCase())) files.push(f);
  }
  console.log(`Trovati ${files.length} file. Upload in corso…`);

  let done = 0;
  let failed = 0;
  let baseUrl = "";
  const queue = files.slice();

  async function worker() {
    while (queue.length) {
      const f = queue.pop();
      const pathname = relative(SRC, f).split(sep).join("/"); // <Cartella>/<file>
      try {
        const body = await readFile(f);
        const { url } = await put(pathname, body, {
          access: "public",
          addRandomSuffix: false,
          allowOverwrite: true,
          contentType: CONTENT_TYPES[extname(f).toLowerCase()],
          token,
        });
        if (!baseUrl) baseUrl = new URL(url).origin;
        done++;
        if (done % 50 === 0) console.log(`  ${done}/${files.length}`);
      } catch (e) {
        failed++;
        console.error(`  FAIL ${pathname}: ${e.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`\nCompletato. OK=${done}  Falliti=${failed}`);
  if (baseUrl) {
    console.log("\nImposta su Vercel (Environment Variables):");
    console.log(`  NEXT_PUBLIC_DOCS_BASE_URL = ${baseUrl}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
