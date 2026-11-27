/**
 * Prova end-to-end LOCALE dell'aggiornamento automatico, senza rete.
 *
 *   npx tsx scripts/test-aggiornamenti.ts
 *
 * - DB libSQL su file temporaneo con lo stesso schema FTS di produzione
 *   (sql/fts5_setup.sql) e una colonna NOT NULL "sconosciuta" per provare
 *   l'inserimento per introspezione;
 * - fetch simulato: pagine elenco con il markup reale dell'Agenzia
 *   (verificato il 26/11/2026) e un PDF minimale generato al volo;
 * - esegue: parsing, pertinenza, deduplica, import, FTS, riconciliazione,
 *   stato. Esce con codice 1 al primo controllo fallito.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fc-agg-")), "test.db");
process.env.TURSO_DATABASE_URL = `file:${dbFile}`;
delete process.env.CF_ACCOUNT_ID;
delete process.env.CF_API_TOKEN;
process.env.CRON_SECRET = "segreto-di-prova";

let fallimenti = 0;
function verifica(cond: unknown, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    console.log(`  ✗ ${msg}`);
    fallimenti++;
  }
}

/* ------------------------------ PDF minimale ------------------------------ */
function pdfConTesto(righe: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const contenuto = ["BT", "/F1 11 Tf", "50 780 Td", "14 TL", ...righe.map((r) => `(${esc(r)}) Tj T*`), "ET"].join("\n");
  const oggetti = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(contenuto, "latin1")} >>\nstream\n${contenuto}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  oggetti.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${oggetti.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${oggetti.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

const PDF_CATASTO = pdfConTesto([
  "Prot. n. 412345/2026",
  "Aggiornamento delle procedure di presentazione degli atti di aggiornamento catastale.",
  "Con il presente provvedimento si dispone che le dichiarazioni Docfa e gli atti Pregeo",
  "relativi al catasto dei fabbricati e al catasto dei terreni siano trasmessi in via telematica.",
  "La voltura catastale e la planimetria dell'unita immobiliare restano disciplinate dal catasto.",
  "Le rendite catastali proposte sono soggette a controllo dell'ufficio provinciale del territorio.",
  "La cartografia catastale e il classamento delle unita immobiliari urbane sono aggiornati.",
]);
const PDF_FISCALE = pdfConTesto([
  "Istituzione dei codici tributo per il versamento delle ritenute sui dividendi.",
  "Si istituiscono i seguenti codici tributo da utilizzare nel modello F24 per i versamenti.",
  "Le somme sono versate entro il giorno sedici del mese successivo a quello di pagamento.",
  "Il presente documento non riguarda alcun aspetto immobiliare e dispone sui soli versamenti.",
]);
const PDF_DUPLICATO = pdfConTesto([
  "Circolare n. 27/E. Rendita catastale delle centrali eoliche e degli impianti.",
  "La determinazione della rendita catastale degli immobili a destinazione speciale del catasto.",
  "Stima diretta delle unita immobiliari censite nel catasto dei fabbricati in categoria D/1.",
]);

// Scansione: pagina senza testo selezionabile -> coda OCR locale, non errore.
const PDF_SCANSIONE = pdfConTesto([]);

/* ------------------------------ HTML elenchi ------------------------------ */
const blocco = (titolo: string, strong: string, href: string, oggetto: string) => `
<div class="journal-content-article " data-analytics-asset-id="1" data-analytics-asset-title="${titolo}" data-analytics-asset-type="web-content">
  <div class="indcart_gn"><p><i class="fa " aria-hidden="true"></i> <strong>${strong} </strong></p>
  <p><a href="${href}">${oggetto}</a></p>
  <p><a href="/portale/documents/d/guest/allegato_1">Allegato - pdf</a></p></div></div>`;

const HTML: Record<string, string> = {
  circolari: `<html><body><div class="journal-content-article " data-analytics-asset-title="hr"></div>
    ${blocco("Circolare n. 27 del 15 marzo 2023", "Circolare n. 27 del 15/03/2023", "https://www.agenziaentrate.gov.it/portale/documents/20143/1/Circolare+n.+27.pdf/aaa?t=1", "Rendita catastale delle centrali eoliche")}
    ${blocco("Circolare n. 9 del 21 ottobre 2026", "Circolare n. 9 del 21/10/2026", "/portale/documents/20143/2/Circolare+n.+9.pdf/bbb?t=2", "Decreto legislativo 12 gennaio 2019, n. 14 – Codice della crisi d&rsquo;impresa")}
    ${blocco("Circolare n. 8 del 6 ottobre 2026", "Circolare n. 8 del 6/10/2026", "/portale/documents/20143/2/Circolare+n.+8.pdf/ccc?t=3", "Concordato preventivo biennale")}
  </body></html>`,
  risoluzioni: `<html><body>
    ${blocco("Risoluzione n. 46 del 23 novembre 2026", "Risoluzione n. 46 del 23/11/2026", "/portale/documents/20143/3/RIS_46.pdf/ddd?t=4", "Istituzione dei codici tributo per il versamento anticipato delle ritenute sui dividendi degli immobili")}
    ${blocco("Risoluzione n. 45 del 13 novembre 2026", "Risoluzione n. 45 del 13/11/2026", "/portale/documents/20143/3/RIS_45.pdf/eee?t=5", "Codici tributo")}
    ${blocco("Risoluzione n. 44 del 10 novembre 2026", "Risoluzione n. 44 del 10/11/2026", "/portale/documents/20143/3/RIS_44.pdf/fff?t=6", "Codici tributo IVA")}
    ${blocco("Risoluzione n. 43 del 3 novembre 2026", "Risoluzione n. 43 del 03/11/2026", "/portale/documents/20143/3/RIS_43_scan.pdf/sca?t=11", "Classamento catastale delle unit&agrave; immobiliari e voltura catastale")}
  </body></html>`,
  provvedimenti: `<html><body>
    <div class="journal-content-article " data-analytics-asset-title="Ultimi Provvedimenti del Direttore soggetti a pubblicit&amp;agrave; legale"><p><strong>Ultimo aggiornamento: 26 novembre 2026</strong></p><p><a href="/portale/documents/20143/296042/Comma+361+doc_comma_361.doc/9e48">(articolo 1, comma 361, della Legge 24 dicembre 2007 n° 244)</a></p></div>
    ${blocco("Provvedimento del 9 settembre 2026", "Provvedimento del 09/09/2026", "/portale/documents/20143/4/idonei_250_FT.pdf/sel?t=10", "Selezione pubblica per l&rsquo;assunzione di 250 funzionari per i servizi catastali e cartografici, estimativi e osservatorio del mercato immobiliare &ndash; Assunzione idonei")}
    ${blocco("Provvedimento del 17/11/2026", "Provvedimento del 17/11/2026", "/portale/documents/20143/4/Provv_catasto.pdf/ggg?t=7", "Modalit&agrave; di presentazione telematica degli atti di aggiornamento catastale Docfa e Pregeo")}
    ${blocco("Provvedimento del 13 novembre 2026", "Provvedimento del 13 novembre 2026", "/portale/documents/20143/4/Provv_cambi.pdf/hhh?t=8", "Accertamento delle medie dei cambi delle valute estere")}
    ${blocco("Provvedimento del 5 novembre 2026", "Provvedimento del 5 novembre 2026", "/portale/documents/20143/4/Provv_crediti.pdf/iii?t=9", "Credito d&rsquo;imposta fondazioni")}
  </body></html>`,
  altri: `<html><body><p>Pagina ristrutturata: nessun blocco atteso</p></body></html>`,
};

const PDF: Record<string, Uint8Array> = {
  "Provv_catasto.pdf": PDF_CATASTO,
  "RIS_46.pdf": PDF_FISCALE,
  "Circolare+n.+27.pdf": PDF_DUPLICATO,
  "RIS_43_scan.pdf": PDF_SCANSIONE,
};

const fetchOriginale = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input instanceof Request ? input.url : input);
  const pagina = url.match(/normativa-e-prassi\/(circolari|risoluzioni|provvedimenti|altri-provvedimenti)/);
  if (pagina) {
    const chiave = pagina[1] === "altri-provvedimenti" ? "altri" : pagina[1];
    return new Response(HTML[chiave], { status: 200, headers: { "content-type": "text/html" } });
  }
  const nome = Object.keys(PDF).find((k) => url.includes(k));
  if (nome) {
    return new Response(PDF[nome] as unknown as BodyInit, { status: 200, headers: { "content-type": "application/pdf" } });
  }
  return new Response("not found", { status: 404 });
}) as typeof fetch;

async function main() {
  const { createClient } = await import("@libsql/client");
  const { parseElenco, parseData, parseNumero, FONTI, decodificaEntita } = await import("../lib/aggiornamenti/fonti");
  const { valutaMetadati, valutaTesto } = await import("../lib/aggiornamenti/pertinenza");
  const { eseguiAggiornamento } = await import("../lib/aggiornamenti/esegui");
  const { leggiStato, leggiStatoBreve } = await import("../lib/aggiornamenti/stato");
  const { chunkTesto } = await import("../lib/aggiornamenti/indicizza");
  const { docUrl } = await import("../lib/docs");

  console.log("\n# Parser");
  verifica(parseData("Circolare n. 9 del 21 ottobre 2026") === "2026-10-21", "data testuale");
  verifica(parseData("Provvedimento del 17/11/2026") === "2026-11-17", "data numerica");
  verifica(parseNumero("Circolare n. 12/E del 3 maggio 2026") === "12", "numero con /E");
  verifica(decodificaEntita("pubblicit&amp;agrave;") === "pubblicità", "entità doppie");
  const circ = parseElenco(HTML.circolari, FONTI[0]);
  verifica(circ.length === 3, `3 circolari lette (lette ${circ.length})`);
  verifica(circ[1]?.url === "https://www.agenziaentrate.gov.it/portale/documents/20143/2/Circolare+n.+9.pdf/bbb", "URL assoluto senza query");
  verifica(circ[1]?.oggetto.includes("crisi d’impresa"), "oggetto decodificato");
  const prov = parseElenco(HTML.provvedimenti, FONTI[2]);
  verifica(prov.length === 4, `intestazione "Ultimo aggiornamento" e link .doc scartati, 4 provvedimenti (letti ${prov.length})`);
  verifica(!prov.some((v) => /\.doc/.test(v.url)), "nessun link non-PDF tra le voci");

  console.log("\n# Pertinenza");
  const m1 = valutaMetadati("Provvedimento", "Modalità di presentazione degli atti di aggiornamento catastale Docfa e Pregeo");
  verifica(m1.scarica && m1.forti.length >= 2, "metadati catastali -> scarica");
  verifica(!valutaMetadati("Circolare n. 8", "Concordato preventivo biennale").scarica, "metadati fiscali -> non scarica");
  const hr = valutaMetadati("Provvedimento", "Selezione pubblica per l'assunzione di funzionari per i servizi catastali e cartografici - Assunzione idonei");
  verifica(!hr.scarica && hr.organizzativo, "atto del personale con termini catastali -> escluso");
  verifica(valutaTesto("Il catasto dei fabbricati e la voltura catastale. Catasto, Docfa, rendita catastale proposta.", m1).pertinente, "testo catastale pertinente");
  verifica(!valutaTesto("Codici tributo per i versamenti F24 delle ritenute.", valutaMetadati("Ris", "codici tributo immobili")).pertinente, "testo fiscale non pertinente");

  console.log("\n# Chunking (porting di ingest_normie.py)");
  const pezzi = chunkTesto("1) Primo comma molto breve.\n2) Secondo comma.\n\n" + "Frase lunga. ".repeat(300));
  verifica(pezzi.length >= 3 && pezzi.every((p) => p.length <= 1600), `chunk entro soglia (${pezzi.length} chunk)`);

  console.log("\n# Database locale");
  const db = createClient({ url: `file:${dbFile}` });
  await db.execute(`CREATE TABLE documenti (
    id INTEGER PRIMARY KEY, cartella_origine TEXT NOT NULL, nuovo_nome_file TEXT NOT NULL,
    anno INTEGER, titolo TEXT, tema TEXT, testo_estratto TEXT, colonna_ignota TEXT NOT NULL)`);
  await db.executeMultiple(fs.readFileSync(path.join(process.cwd(), "sql", "fts5_setup.sql"), "utf8"));
  await db.execute({
    sql: `INSERT INTO documenti (id, cartella_origine, nuovo_nome_file, anno, titolo, tema, testo_estratto, colonna_ignota)
          VALUES (80, '02 - Circolari', '2023 - Circ. 27 - Rendita catastale centrali eoliche.pdf', 2023,
                  'Circ. 27 - Rendita catastale centrali eoliche', '', 'Rendita catastale delle centrali eoliche', 'x')`,
    args: [],
  });

  console.log("\n# Prova a secco (nessuna scrittura)");
  const secco = await eseguiAggiornamento({ innesco: "prova", prova: true });
  verifica(secco.esito === "parziale", `esito parziale per la pagina 'altri' cambiata (esito: ${secco.esito})`);
  verifica(secco.voci.some((v) => v.esito === "da_importare"), "il provvedimento catastale risulta da importare");
  const nTabelle = await db.execute(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'aggiornamenti_esecuzioni'`);
  verifica(Number(nTabelle.rows[0].n) === 0, "la prova non ha creato tabelle");

  console.log("\n# Route HTTP senza ?limite (regressione: Number(null) === 0)");
  const { GET } = await import("../app/api/cron/aggiorna-normativa/route");
  const { NextRequest } = await import("next/server");
  const nonAuth = await GET(new NextRequest("http://localhost/api/cron/aggiorna-normativa"));
  verifica(nonAuth.status === 401, `senza Authorization -> 401 (status ${nonAuth.status})`);
  const viaRoute = await GET(
    new NextRequest("http://localhost/api/cron/aggiorna-normativa?prova=1", { headers: { authorization: "Bearer segreto-di-prova" } })
  );
  const jr = (await viaRoute.json()) as { voci: Array<{ esito: string }>; prova: boolean };
  verifica(jr.prova === true, "con Authorization e ?prova=1 -> prova a secco");
  verifica(jr.voci.some((v) => v.esito === "da_importare") && !jr.voci.some((v) => v.esito === "rimandata"), "nessuna voce 'rimandata' senza ?limite");

  console.log("\n# Esecuzione reale");
  const r = await eseguiAggiornamento({ innesco: "manuale" });
  console.log(`  -> ${r.esito}: ${r.messaggio}`);
  verifica(r.importati === 1, `1 atto importato (importati: ${r.importati})`);
  verifica(r.duplicati === 1, `circolare 27/2023 riconosciuta come duplicato (duplicati: ${r.duplicati})`);
  verifica(r.scartati >= 4, `atti fiscali scartati (scartati: ${r.scartati})`);
  verifica(r.esito === "parziale", "esito parziale: una fonte con struttura cambiata non passa sotto silenzio");
  verifica(r.daOcr === 1 && r.errori === 0, `PDF scansionato in coda OCR, non contato come errore (daOcr: ${r.daOcr}, errori: ${r.errori})`);
  const imp = r.voci.find((v) => v.esito === "importato");
  verifica(imp?.titolo === "Prov. 412345 - " + imp?.titolo?.split(" - ").slice(1).join(" - "), `titolo col protocollo (${imp?.titolo})`);

  const riga = await db.execute(`SELECT id, cartella_origine, nuovo_nome_file, titolo, anno, colonna_ignota FROM documenti WHERE id <> 80`);
  verifica(riga.rows.length === 1, "una riga nuova in documenti");
  const nuovo = riga.rows[0];
  verifica(String(nuovo.cartella_origine) === "19 - Provvedimenti", "cartella del corpus corretta");
  verifica(String(nuovo.nuovo_nome_file).startsWith("https://www.agenziaentrate.gov.it/"), "URL ufficiale come nome file");
  verifica(docUrl(String(nuovo.cartella_origine), String(nuovo.nuovo_nome_file)) === String(nuovo.nuovo_nome_file), "docUrl usa l'URL esterno");
  const fts = await db.execute({ sql: `SELECT rowid FROM documenti_fts WHERE documenti_fts MATCH 'pregeo'`, args: [] });
  verifica(fts.rows.some((x) => Number(x.rowid) === Number(nuovo.id)), "nuovo atto trovato dalla ricerca FTS");

  console.log("\n# Seconda esecuzione: idempotenza");
  const r2 = await eseguiAggiornamento({ innesco: "manuale" });
  verifica(r2.importati === 0 && r2.nuoveVoci === 0, `nessuna voce rielaborata (nuove: ${r2.nuoveVoci})`);

  console.log("\n# Riconciliazione dopo un sync che cancella l'atto");
  await db.execute({ sql: `DELETE FROM documenti WHERE id = ?`, args: [nuovo.id] });
  const r3 = await eseguiAggiornamento({ innesco: "manuale" });
  verifica(r3.ripristinati === 1, `atto ripristinato (ripristinati: ${r3.ripristinati})`);
  const dopo = await db.execute(`SELECT COUNT(*) AS n FROM documenti WHERE nuovo_nome_file LIKE 'https://%'`);
  verifica(Number(dopo.rows[0].n) === 1, "di nuovo presente in documenti");

  console.log("\n# Stato");
  const s = await leggiStato();
  verifica(s.esecuzioni.length === 3, `3 esecuzioni registrate (${s.esecuzioni.length})`);
  verifica(s.voci.some((v) => v.stato === "importato"), "atto importato elencato");
  verifica(s.voci.some((v) => v.stato === "needs_ocr") && s.avvisi.some((a) => /ocr:locale/.test(a)), "atto scansionato elencato «da OCR» con l'istruzione");
  verifica(s.avvisi.some((a) => /parziale|Normie/.test(a)), "avvisi presenti (fonte cambiata / Normie)");
  const b = await leggiStatoBreve();
  verifica(b.importatiUltimi30gg === 1 && b.documenti === 2, `stato breve coerente (${JSON.stringify(b)})`);

  globalThis.fetch = fetchOriginale;
  console.log(fallimenti === 0 ? "\nTUTTI I CONTROLLI SUPERATI" : `\n${fallimenti} CONTROLLI FALLITI`);
  process.exit(fallimenti === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
