/**
 * Prova LOCALE della ricerca ibrida della home (FTS + Vectorize, RRF), senza rete.
 *
 *   npx tsx scripts/test-ricerca.ts
 *
 * Verifica: codici ed estremi sempre sulla ricerca testuale (nessun
 * embedding, nessuna query), domande discorsive in ibrida, fusione RRF,
 * documenti trovati solo per significato con il loro passaggio, degradazione
 * silenziosa a indice incompleto o tetto mensile raggiunto.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fc-ric-")), "test.db");
process.env.TURSO_DATABASE_URL = `file:${dbFile}`;
process.env.CF_ACCOUNT_ID = "acc-prova";
process.env.CF_API_TOKEN = "token-prova";
process.env.CF_VECTORIZE_INDEX = "normie-catasto";
process.env.AI_SEED_INSTALLAZIONE = "0";
process.env.AI_SYNC_REMOTA = "0";

let fallimenti = 0;
const verifica = (c: unknown, m: string) => {
  console.log(`  ${c ? "✓" : "✗"} ${m}`);
  if (!c) fallimenti++;
};

const rete = { embedding: 0, query: 0 };
// Vettori semantici simulati: la query "pannelli solari sui tetti" e' vicina al
// documento 3 (che parla di impianti fotovoltaici senza la parola "pannelli").
const vicini: Array<{ id: string; score: number }> = [
  { id: "3-0", score: 0.71 },
  { id: "1-0", score: 0.52 },
  { id: "2-0", score: 0.2 },
];
const ok = (result: unknown) => new Response(JSON.stringify({ success: true, result }), { status: 200, headers: { "content-type": "application/json" } });
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.endsWith("/info")) return ok({ dimensions: 128, vectorCount: 3 });
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  if (url.includes("/query")) {
    rete.query++;
    return ok({ matches: vicini.slice(0, body.topK) });
  }
  if (url.includes("embeddinggemma")) {
    rete.embedding++;
    return ok({ data: (body.input as string[]).map((_, index) => ({ index, embedding: Array.from({ length: 128 }, () => 0.1) })), usage: { prompt_tokens: 12 } });
  }
  return new Response("non simulato", { status: 404 });
}) as typeof fetch;

async function main() {
  const ri = await import("../lib/ricerca-ibrida");

  console.log("\n# Quando la ricerca resta testuale");
  for (const q of ["F/3", "categoria D/1", "Circ. 2/2016", "D.P.R. 1142/1949", "legge 662/1996", "decreto-legge n. 557", "risoluzione 12/E", "art. 9", "«voltura catastale»"]) {
    verifica(ri.decidiModo(q, { ibrida: true, exact: false }).modo === "testuale", `«${q}» con ibrida attiva → testuale (codice o estremi)`);
  }
  verifica(ri.decidiModo("voltura", { ibrida: false, exact: false }).modo === "testuale", "parola singola senza interruttore → testuale (predefinita)");
  verifica(ri.decidiModo("voltura", { ibrida: true, exact: false }).modo === "ibrida", "parola singola con interruttore → ibrida");
  verifica(ri.decidiModo("come si accatastano i pannelli fotovoltaici?", { ibrida: false, exact: false }).modo === "ibrida", "domanda discorsiva → ibrida automatica");
  verifica(ri.decidiModo("come si accatastano i pannelli", { ibrida: true, exact: true }).modo === "testuale", "ricerca esatta → sempre testuale");

  console.log("\n# Reciprocal Rank Fusion");
  const fusi = ri.fondiRrf([[10, 20, 30], [30, 40, 10]]);
  verifica(fusi[0].id === 10 && fusi[1].id === 30 && fusi.length === 4, `documenti presenti in entrambe le liste in testa (${fusi.map((f) => f.id).join(",")})`);
  const snip = ri.snippetPassaggio("Gli impianti fotovoltaici installati sui tetti degli edifici <b>non</b> richiedono variazione.", "impianti sui tetti");
  verifica(/<mark>impianti<\/mark>/.test(snip) && /<mark>tetti<\/mark>/.test(snip) && !/<b>/.test(snip), "snippet del passaggio: parole evidenziate, HTML neutralizzato");

  console.log("\n# API /api/search");
  const { getDb } = await import("../lib/db");
  const db = getDb();
  await db.execute(`CREATE TABLE documenti (id INTEGER PRIMARY KEY, cartella_origine TEXT, nuovo_nome_file TEXT, anno INTEGER, titolo TEXT, tema TEXT, testo_estratto TEXT)`);
  await db.executeMultiple(fs.readFileSync(path.join(process.cwd(), "sql", "fts5_setup.sql"), "utf8"));
  const docs: Array<[number, string, number, string, string]> = [
    [1, "02 - Circolari", 2016, "Circ. 2 - Pannelli e coperture", "I pannelli posti sui tetti non modificano la rendita se non aumentano il valore. Categoria F/3 per le unità in costruzione."],
    [2, "20 - Risoluzioni", 2010, "Ris. 3 - Imposte di registro", "Imposte di registro sugli atti di compravendita."],
    [3, "02 - Circolari", 2013, "Circ. 36 - Impianti fotovoltaici", "Gli impianti fotovoltaici installati sulle coperture degli edifici non richiedono autonoma iscrizione in catasto."],
    [4, "20 - Risoluzioni", 2011, "Ris. 9 - Agevolazioni", "Si applica la lettera f) 3. del regolamento; per la categoria D/10 vedi oltre."],
  ];
  for (const d of docs) await db.execute({ sql: `INSERT INTO documenti (id, cartella_origine, nuovo_nome_file, anno, titolo, tema, testo_estratto) VALUES (?, ?, ?, ?, ?, '', ?)`, args: [d[0], d[1], `${d[2]} - ${d[3]}.pdf`, d[2], d[3], d[4]] });
  const pz = await import("../lib/ai/passaggi");
  await pz.assicuraSchemaIndice(db);
  for (const d of docs) {
    await db.execute({ sql: `INSERT INTO passaggi (id, doc_id, ord, inizio, lunghezza) VALUES (?, ?, 0, 0, ?)`, args: [`${d[0]}-0`, d[0], d[4].length] });
    await db.execute({ sql: `INSERT INTO vectorize_documenti (doc_id, vettori, totali, caratteri, modello, dimensioni, indicizzato_il) VALUES (?, 1, 1, ?, '@cf/google/embeddinggemma-2', 128, '2026-11-27')`, args: [d[0], d[4].length] });
  }
  const { GET } = await import("../app/api/search/route");
  const { NextRequest } = await import("next/server");
  const cerca = async (qs: string) => {
    const res = await GET(new NextRequest(`http://localhost/api/search?${qs}`, { headers: { "x-forwarded-for": "10.3.3.3" } }));
    return (await res.json()) as import("../lib/types").SearchResponse;
  };
  const idDi = (r: import("../lib/types").SearchResponse) => r.groups.flatMap((g) => g.files.map((f) => f.id));

  const nonPronto = await cerca("q=pannelli%20sui%20tetti&modo=ibrida");
  verifica(nonPronto.modo === "testuale" && /non disponibile/.test(nonPronto.nota ?? "") && rete.embedding === 0 && idDi(nonPronto).join() === "1", `indice non completo: risultati testuali con nota, nessun embedding (${idDi(nonPronto).join()})`);

  // Indice completo per la generazione corrente.
  const vz = await import("../lib/ai/vectorize");
  await db.batch(
    [
      { sql: `INSERT OR REPLACE INTO vectorize_indice (chiave, valore) VALUES ('generazione', ?)`, args: [vz.generazioneCorrente()] },
      `INSERT OR REPLACE INTO vectorize_indice (chiave, valore) VALUES ('completata_il', '2026-11-27T07:00:00Z')`,
    ],
    "write"
  );
  pz.invalidaRiepilogo();
  vz._azzeraPerTest();

  const ibrida = await cerca("q=pannelli%20sui%20tetti&modo=ibrida");
  const file3 = ibrida.groups.flatMap((g) => g.files).find((f) => f.id === 3);
  verifica(ibrida.modo === "ibrida" && rete.embedding === 1 && rete.query === 1, "indice completo: un embedding e una query Vectorize");
  verifica(idDi(ibrida).includes(1) && file3?.perSignificato === true && ibrida.semantici === 1, `documento sugli impianti fotovoltaici trovato solo per significato (${idDi(ibrida).join()})`);
  verifica(idDi(ibrida)[0] === 1 && !idDi(ibrida).includes(2), "RRF: in testa il documento presente in entrambe le liste; sotto soglia escluso");
  verifica(/impianti fotovoltaici/.test(file3?.snippetHtml ?? ""), "snippet dal passaggio indicizzato (testo da Turso)");

  const embPrima = rete.embedding;
  const codice = await cerca("q=F%2F3&modo=ibrida");
  verifica(codice.modo === "testuale" && /Codice o estremi/.test(codice.nota ?? "") && rete.embedding === embPrima && idDi(codice).join() === "1", `«F/3» con ibrida attiva: solo testuale, nessun embedding, «lettera f) 3.» scartata (${idDi(codice).join()})`);
  const d1 = await cerca("q=D%2F1");
  verifica(idDi(d1).length === 0, "«D/1» non trova chi cita solo «D/10»");

  const auto = await cerca("q=come%20si%20accatastano%20gli%20impianti%20fotovoltaici%3F");
  verifica(auto.modo === "ibrida" && idDi(auto).includes(3), "domanda discorsiva senza interruttore: ibrida automatica, parole vuote tolte dall'FTS");

  // Tetto mensile delle dimensioni interrogate raggiunto.
  const sv = await vz.statoVectorize();
  await db.execute({ sql: `UPDATE vectorize_uso SET query = ?`, args: [sv.maxQueryMese] });
  const qPrima = rete.query;
  const tetto = await cerca("q=coperture%20degli%20edifici&modo=ibrida");
  verifica(tetto.modo === "testuale" && rete.query === qPrima && !tetto.error, "tetto mensile raggiunto: ricerca testuale senza errori, nessuna query");

  console.log(fallimenti === 0 ? "\nTUTTI I CONTROLLI SUPERATI" : `\n${fallimenti} CONTROLLI FALLITI`);
  process.exit(fallimenti === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
