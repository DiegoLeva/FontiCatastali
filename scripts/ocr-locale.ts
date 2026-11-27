/**
 * OCR LOCALE e gratuito degli atti scansionati in coda ("needs_ocr").
 *
 * Il cron del lunedi' non usa OCR a pagamento: i PDF senza testo restano in
 * coda (visibili su /aggiornamenti, filtro "da OCR"). Questo script, lanciato
 * dal tuo PC quando vuoi, ne estrae il testo con tesseract e li importa nel
 * corpus con la stessa pipeline del cron (pertinenza, deduplica, titolo,
 * metadati normalizzati).
 *
 * Requisiti: tesseract (lingua italiana) e pdftoppm (poppler)
 *   macOS:   brew install tesseract tesseract-lang poppler
 *   Ubuntu:  sudo apt install tesseract-ocr tesseract-ocr-ita poppler-utils
 *   Windows: installa Tesseract (UB Mannheim) con l'italiano e Poppler, poi aggiungili al PATH
 *
 * Uso (TURSO_DATABASE_URL e TURSO_AUTH_TOKEN da .env.local o dall'ambiente;
 * il token deve poter scrivere):
 *   npm run ocr:locale -- --prova       (solo OCR e valutazione, nessuna scrittura)
 *   npm run ocr:locale
 *   npm run ocr:locale -- --limite 5
 *
 * Nessuna chiamata AI: il titolo usa l'oggetto ufficiale (come il ripiego del
 * cron), quindi nessun neurone consumato.
 */
import "./env-locale";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const prova = args.includes("--prova");
const limite = Number(args[args.indexOf("--limite") + 1]) || 20;

function disponibile(cmd: string, versione: string[]): boolean {
  const r = spawnSync(cmd, versione, { encoding: "utf8" });
  return r.status === 0 || /tesseract|pdftoppm|poppler/i.test(`${r.stdout}${r.stderr}`);
}

function ocrPdf(file: string, cartella: string): string {
  const base = path.join(cartella, "pagina");
  const conv = spawnSync("pdftoppm", ["-r", "300", "-png", file, base], { encoding: "utf8" });
  if (conv.status !== 0) throw new Error(`pdftoppm: ${conv.stderr || conv.status}`);
  const pagine = fs.readdirSync(cartella).filter((f) => f.startsWith("pagina") && f.endsWith(".png")).sort();
  const testi: string[] = [];
  for (const p of pagine) {
    const r = spawnSync("tesseract", [path.join(cartella, p), "stdout", "-l", "ita"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`tesseract: ${r.stderr || r.status}`);
    testi.push(r.stdout);
  }
  return testi.join("\n\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

async function main() {
  if (!disponibile("tesseract", ["--version"]) || !disponibile("pdftoppm", ["-v"])) {
    console.error("Servono tesseract (con la lingua ita) e pdftoppm (poppler): vedi le istruzioni in testa al file.");
    process.exit(1);
  }
  const { createHash } = await import("node:crypto");
  const { getDb } = await import("../lib/db");
  const { FONTI } = await import("../lib/aggiornamenti/fonti");
  const { valutaMetadati, valutaTesto } = await import("../lib/aggiornamenti/pertinenza");
  const { cercaDuplicato, inserisciDocumento, registraVoce } = await import("../lib/aggiornamenti/archivio");
  const { chiaveAtto, oggettoDiRipiego } = await import("../lib/aggiornamenti/esegui");
  const { eseguiBonifica } = await import("../lib/metadati/bonifica");
  const db = getDb();

  const conArchivio = (await db.execute(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'archivio_pdf'`)).rows.length > 0;
  const rs = await db.execute({
    sql: `SELECT v.url, v.fonte, v.tipo, v.numero, v.data, v.anno, v.titolo_fonte, v.oggetto${conArchivio ? ", a.url_pubblico" : ""}
          FROM aggiornamenti_voci v ${conArchivio ? "LEFT JOIN archivio_pdf a ON a.url = v.url" : ""}
          WHERE v.stato = 'needs_ocr' ORDER BY v.aggiornato_il LIMIT ?`,
    args: [limite],
  });
  console.log(`${rs.rows.length} atti in coda per l'OCR${prova ? " (prova: nessuna scrittura)" : ""}.`);
  const fonti = new Map(FONTI.map((f) => [f.id, f]));

  for (const r of rs.rows) {
    const url = String(r.url);
    const fonte = fonti.get(String(r.fonte));
    const titoloFonte = String(r.titolo_fonte ?? "");
    const oggetto = String(r.oggetto ?? "");
    console.log(`\n• ${titoloFonte || url}`);
    if (!fonte) {
      console.log("  fonte sconosciuta: salto");
      continue;
    }
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fc-ocr-"));
    try {
      const sorgente = String(r.url_pubblico ?? "") || url;
      const res = await fetch(sorgente, { headers: { "user-agent": "FontiCatastali-OCR/1.0" } });
      if (!res.ok) throw new Error(`download HTTP ${res.status}`);
      const pdf = new Uint8Array(await res.arrayBuffer());
      const file = path.join(tmp, "atto.pdf");
      fs.writeFileSync(file, pdf);
      const testo = ocrPdf(file, tmp);
      console.log(`  OCR: ${testo.length.toLocaleString("it-IT")} caratteri`);
      const sha256 = createHash("sha256").update(pdf).digest("hex");
      const base = { url, fonte: fonte.id, titoloFonte, oggetto, tipo: String(r.tipo), numero: r.numero == null ? null : String(r.numero), data: r.data == null ? null : String(r.data), anno: r.anno == null ? null : Number(r.anno) };
      const chiave = chiaveAtto(base.tipo, base.numero, base.anno, base.data);
      if (testo.length < 200) {
        console.log("  testo insufficiente anche con l'OCR: resta in coda");
        continue;
      }
      const valutazione = valutaTesto(testo, valutaMetadati(titoloFonte, oggetto));
      if (!valutazione.pertinente) {
        console.log(`  non pertinente: ${valutazione.motivo}`);
        if (!prova) await registraVoce(db, { ...base, chiave, stato: "non_pertinente", motivo: `dopo OCR: ${valutazione.motivo}`, punteggio: valutazione.punteggio, sha256 });
        continue;
      }
      const anno = base.anno ?? new Date().getUTCFullYear();
      const duplicato = await cercaDuplicato(db, base.tipo, base.numero, anno, url, oggetto);
      if (duplicato) {
        console.log(`  già nel corpus (#${duplicato})`);
        if (!prova) await registraVoce(db, { ...base, anno, chiave, stato: "duplicato", motivo: `già presente nel corpus (documento #${duplicato})`, docId: duplicato, sha256 });
        continue;
      }
      const dataBreve = base.data ? base.data.split("-").reverse().join("/") : null;
      const ogg = oggettoDiRipiego(oggetto || titoloFonte);
      const titolo = base.numero ? `${fonte.abbrev} ${base.numero} - ${ogg}` : dataBreve ? `${fonte.abbrev} del ${dataBreve} - ${ogg}` : `${fonte.abbrev} - ${ogg}`;
      if (prova) {
        console.log(`  da importare come «${titolo}»`);
        continue;
      }
      const docId = await inserisciDocumento(db, { cartella: fonte.cartella, nomeFile: url, titolo, anno, testo, tipo: base.tipo, numero: base.numero, data: base.data, sha256 });
      await registraVoce(db, { ...base, anno, chiave, stato: "importato", motivo: `importato dopo OCR locale (${valutazione.motivo})`, punteggio: valutazione.punteggio, docId, sha256, titolo, cartella: fonte.cartella, testo });
      if (conArchivio) await db.execute({ sql: `UPDATE archivio_pdf SET doc_id = ?, stato = 'importato' WHERE url = ?`, args: [docId, url] });
      await eseguiBonifica(db, { applica: true, ids: [docId] });
      console.log(`  importato come #${docId}: «${titolo}»`);
    } catch (err) {
      console.log(`  errore: ${(err as Error).message}`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
