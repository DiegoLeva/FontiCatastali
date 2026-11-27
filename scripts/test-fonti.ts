/**
 * Prova LOCALE delle nuove fonti (senza rete): Gazzetta Ufficiale (feed RSS
 * della Serie Generale e testo HTML degli atti) e archivi storici dell'Agenzia.
 * I campioni riproducono il markup reale verificato il 27/11/2026.
 *
 *   npx tsx scripts/test-fonti.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fc-fonti-")), "test.db");
process.env.TURSO_DATABASE_URL = `file:${dbFile}`;

let fallimenti = 0;
const verifica = (c: unknown, m: string) => {
  console.log(`  ${c ? "✓" : "✗"} ${m}`);
  if (!c) fallimenti++;
};

const RSS = `<?xml version="1.0" encoding="UTF-8"?>\r
<rss xmlns:content="http://purl.org/rss/1.0/modules/content/" version="2.0">\r
  <channel>\r
    <title>Gazzetta Ufficiale - Serie Generale - Sommario</title>\r
    <link>http://www.gazzettaufficiale.it/eli/gu/2026/11/26/276/SG/html</link>\r
    <item>\r
      <title>DECRETO DEL PRESIDENTE DELLA REPUBBLICA 15 settembre 2026, n.217</title>\r
      <link>http://www.gazzettaufficiale.it/eli/id/2026/11/26/26G00229/SG</link>\r
      <content:encoded>Esecuzione dell'Intesa tra la Presidenza del Consiglio dei ministri e\nla Presidenza della Conferenza Episcopale  Italiana. (26G00229)</content:encoded>\r
      <pubDate>Thu, 26 Nov 2026 18:32:58 GMT</pubDate>\r
    </item>\r
    <item>\r
      <title>MINISTERO DELL'ECONOMIA E DELLE FINANZE - DECRETO 13 novembre 2026</title>\r
      <link>http://www.gazzettaufficiale.it/eli/id/2026/11/26/26A06163/SG</link>\r
      <content:encoded>Autorizzazione alla riscossione coattiva  mediante  ruolo dei crediti vantati  da  Lazio  Innova  S.p.a. (26A06163)</content:encoded>\r
    </item>\r
    <item>\r
      <title>AGENZIA DELLE ENTRATE - PROVVEDIMENTO 20 novembre 2026</title>\r
      <link>http://www.gazzettaufficiale.it/eli/id/2026/11/26/26A06200/SG</link>\r
      <content:encoded>Modalit&agrave; di presentazione telematica degli atti di aggiornamento catastale DOCFA e delle volture. (26A06200)</content:encoded>\r
    </item>\r
  </channel>\r
</rss>`;

const PAGINA_ATTO = `<html><head><title>x</title><script>var a = "catasto catasto";</script></head><body>
<div class="art"><p>IL DIRETTORE DELL'AGENZIA</p><p>Visto il decreto legislativo 30 luglio 1999, n. 300;</p>
<p>Dispone:</p><p>1. Le dichiarazioni di aggiornamento del catasto dei fabbricati (DOCFA) e le domande di voltura catastale si presentano in via telematica.</p>
<p>2. La rendita catastale proposta e il classamento delle unit&agrave; immobiliari urbane sono verificati dagli uffici provinciali.</p>
<p>3. Il presente provvedimento &egrave; pubblicato nella Gazzetta Ufficiale e riguarda il catasto e la pubblicit&agrave; immobiliare.</p></div></body></html>`;

const rete: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input instanceof Request ? input.url : input);
  rete.push(url);
  if (url.endsWith("/rss/SG")) return new Response(RSS, { status: 200, headers: { "content-type": "application/rss+xml" } });
  if (url.includes("caricaArticoloDefault") && url.includes("26A06200")) return new Response(PAGINA_ATTO, { status: 200, headers: { "content-type": "text/html" } });
  return new Response("non trovato", { status: 404 });
}) as typeof fetch;

const INDICE = `<div class="indcart_gn"><ul>
  <li><a href="/portale/circolari-2026">Le circolari del 2026</a></li>
  <li><a href="/portale/circolari-2025">Le circolari del 2025</a></li>
  <li><a href="https://www.agenziaentrate.gov.it/portale/normativa-e-prassi/circolari/archivio-circolari/2006">Le circolari del 2006</a></li>
  <li><a href="https://ec.europa.eu/taxation_customs/vies/">Archivio Vies 2020</a></li>
</ul></div>`;
const ANNO = `<div class="indcart_gn">
  <a href="https://www.agenziaentrate.gov.it/portale/dicembre-2025-circolari">Dicembre 2025 (dalla n° 13 alla n° 15)</a>
  <a href="https://www.agenziaentrate.gov.it/portale/novembre-2025-circolari">Novembre 2025</a>
  <a href="/portale/web/guest/agenzia/chi-siamo">Chi siamo</a></div>`;
const MESE = `<div class="journal-content-article " data-analytics-asset-title="Circolare n. 15 del 22 dicembre 2025">
  <div class="indcart_gn"><p><strong>Circolare n. 15 del 22/12/2025 </strong></p>
  <p><a href="/portale/documents/20143/1/Circolare+n.+15.pdf/abc?t=1">Rendita catastale degli immobili a destinazione speciale</a></p></div></div>`;
const TERRITORIO = `<div class="journal-content-article " data-analytics-asset-title="Archivio 2010"><h1>Archivio 2010</h1><ul>
  <li><a href="http://wwwt.agenziaentrate.gov.it/mt/circolari/Circolari_2010/circolare%203_2010%20prot%20%2042436.pdf" target="" title="">Circolare n.3/2010 </a> <br> Interpretazione dell'art. 19 del decreto legge 31 maggio 2010, n.78 - Aggiornamento del catasto.<br><br></li>
  <li><a href="http://wwwt.agenziaentrate.gov.it/mt/circolari/Circolari_2010/Circolare1_2010_Pregeo10.pdf">Circolare n.1/2010 Pregeo 10</a></li>
  <li><a href="http://wwwt.agenziaentrate.gov.it/mt/circolari/Circolari_2010/ALL1_RC12E_Circolare_2010.pdf">Allegato alla Circ. 1/2010 – Richiesta Estratto di mappa</a></li>
</ul></div>`;

async function main() {
  const gu = await import("../lib/aggiornamenti/gazzetta");

  console.log("\n# Gazzetta Ufficiale: feed della Serie Generale");
  const atti = gu.parseRssGazzetta(RSS);
  verifica(atti.length === 3, `3 atti dal feed (${atti.length})`);
  const dpr = atti[0];
  verifica(dpr.tipo === "D.P.R." && dpr.numero === "217" && dpr.data === "2026-09-15" && dpr.pubblicazione === "2026-11-26", `D.P.R. n. 217 del 15/09/2026, pubblicato il 26/11 (${JSON.stringify({ t: dpr.tipo, n: dpr.numero, d: dpr.data })})`);
  verifica(dpr.link === "https://www.gazzettaufficiale.it/eli/id/2026/11/26/26G00229/SG" && dpr.codice === "26G00229", "link ELI in https e codice redazionale");
  verifica(!/26G00229/.test(dpr.oggetto) && !/\s{2}/.test(dpr.oggetto), "oggetto pulito (senza codice finale e spazi doppi)");
  verifica(atti[1].emittente === "MINISTERO DELL'ECONOMIA E DELLE FINANZE" && atti[1].tipo === "Decreto", "emittente e tipo dal titolo");
  verifica(atti.filter(gu.pertinenteGazzetta).map((x) => x.codice).join() === "26A06200", "filtro rigoroso: solo l'atto catastale");
  verifica(gu.urlTestoGazzetta(atti[2]) === "https://www.gazzettaufficiale.it/atto/serie_generale/caricaArticoloDefault/originario?atto.dataPubblicazioneGazzetta=2026-11-26&atto.codiceRedazionale=26A06200", "URL del testo dell'atto");
  const testo = gu.testoDaHtmlGazzetta(PAGINA_ATTO);
  verifica(/unità immobiliari urbane/.test(testo) && !/var a/.test(testo) && testo.split("\n").length >= 4, "testo HTML dell'atto: entità decodificate, script tolti, paragrafi conservati");
  verifica(gu.destinazioneGazzetta("Decreto legislativo").cartella === "06 - Decreti Legge" && gu.destinazioneGazzetta("Legge").cartella === "12 - Leggi", "cartelle del corpus per tipo di atto");

  console.log("\n# Gazzetta Ufficiale: import nel corpus");
  const { getDb } = await import("../lib/db");
  const db = getDb();
  await db.execute(`CREATE TABLE documenti (id INTEGER PRIMARY KEY, cartella_origine TEXT NOT NULL, nuovo_nome_file TEXT NOT NULL, anno INTEGER, titolo TEXT, tema TEXT, testo_estratto TEXT)`);
  await db.executeMultiple(fs.readFileSync(path.join(process.cwd(), "sql", "fts5_setup.sql"), "utf8"));
  const secco = await gu.importaGazzetta(db, { prova: true });
  const tabelle = await db.execute(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'aggiornamenti_voci'`);
  verifica(secco.pertinenti === 1 && secco.voci[0]?.esito === "da_importare" && Number(tabelle.rows[0].n) === 0, "prova a secco: 1 atto da importare, nessuna tabella creata");
  rete.length = 0;
  const e1 = await gu.importaGazzetta(db);
  verifica(e1.letti === 3 && e1.importati === 1 && e1.idImportati.length === 1, `import reale: 1 atto importato (${JSON.stringify({ i: e1.importati, s: e1.scartati, e: e1.errori, err: e1.errore })})`);
  verifica(rete.filter((u) => u.includes("caricaArticolo")).length === 1, "scaricato solo il testo dell'atto pertinente");
  const doc = (await db.execute(`SELECT cartella_origine, nuovo_nome_file, titolo, anno FROM documenti`)).rows[0];
  verifica(doc?.cartella_origine === "19 - Provvedimenti" && doc.nuovo_nome_file === atti[2].link && /^Prov\. del 20\/11\/2026 - /.test(String(doc.titolo)) && Number(doc.anno) === 2026, `documento: ${doc?.titolo} (${doc?.cartella_origine})`);
  const fts = await db.execute(`SELECT rowid FROM documenti_fts WHERE documenti_fts MATCH 'docfa'`);
  verifica(fts.rows.length === 1, "trovabile dalla ricerca testuale");
  const e2 = await gu.importaGazzetta(db);
  verifica(e2.importati === 0 && e2.nuovi === 0, "secondo controllo dello stesso numero: nulla da rifare");
  await gu.registraControllo(db, e1);
  const c = await gu.controlliQuotidiani(db);
  verifica(c.length === 1 && c[0].importati === 1 && c[0].letti === 3, "ultimo controllo registrato per /aggiornamenti");

  console.log("\n# Archivi storici dell'Agenzia");
  const st = await import("../lib/aggiornamenti/storico");
  const anni = st.linkAnni(INDICE);
  verifica(anni.map((x) => x.anno).join() === "2026,2025,2006" && anni[0].url === "https://www.agenziaentrate.gov.it/portale/circolari-2026", `pagine per anno, link esterni scartati (${anni.map((x) => x.anno).join()})`);
  const mesi = st.linkMesi(ANNO);
  verifica(mesi.length === 2 && mesi[0].url.endsWith("/dicembre-2025-circolari"), "pagine per mese");
  const circ = st.ARCHIVI_ADE.find((x) => x.id === "circolari")!;
  const delMese = st.vociPagina(MESE, circ.fonte);
  verifica(delMese.length === 1 && delMese[0].numero === "15" && delMese[0].url === "https://www.agenziaentrate.gov.it/portale/documents/20143/1/Circolare+n.+15.pdf/abc", "atti della pagina mensile (stesso parser del cron)");
  const terr = st.ARCHIVI_ADE.find((x) => x.id === "territorio-circolari")!;
  const delTerritorio = st.vociPagina(TERRITORIO, terr.fonte);
  verifica(delTerritorio.length === 2 && delTerritorio[0].numero === "3" && delTerritorio[0].anno === 2010 && /Aggiornamento del catasto/.test(delTerritorio[0].oggetto), `elenco dell'ex Territorio: allegati esclusi (${delTerritorio.map((v) => `${v.numero}/${v.anno}`).join(", ")})`);

  console.log("\n# Cron giornaliero");
  process.env.CRON_SECRET = "segreto";
  const { GET } = await import("../app/api/cron/giornaliero/route");
  const { NextRequest } = await import("next/server");
  const senza = await GET(new NextRequest("http://localhost/api/cron/giornaliero"));
  verifica(senza.status === 401, "senza Authorization: 401");

  console.log(fallimenti === 0 ? "\nTUTTI I CONTROLLI SUPERATI" : `\n${fallimenti} CONTROLLI FALLITI`);
  process.exit(fallimenti === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
