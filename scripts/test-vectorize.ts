/**
 * Prova LOCALE dell'indice semantico compatto, senza rete.
 *
 *   npx tsx scripts/test-vectorize.ts
 *
 * Workers AI (EmbeddingGemma-2, reranker, LLM) e Vectorize sono simulati.
 * Verifica: passaggi con offset compatibili con substr() di SQLite (anche con
 * caratteri fuori dal piano base), piano con tetto per documento, ricostruzione
 * a lotti idempotente con budget di neuroni e ripresa, doppioni esclusi,
 * documenti cambiati o rimossi, tetti Vectorize (memorizzate e interrogate),
 * Normie sui passaggi di Turso con canale semantico + testuale.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fc-vz-")), "test.db");
process.env.TURSO_DATABASE_URL = `file:${dbFile}`;
process.env.CF_ACCOUNT_ID = "acc-prova";
process.env.CF_API_TOKEN = "token-prova";
process.env.CF_VECTORIZE_INDEX = "normie-catasto";
process.env.AI_SEED_INSTALLAZIONE = "0";
process.env.AI_SYNC_REMOTA = "0";
// Tetti piccoli per provarli: 40 vettori da 256 dimensioni memorizzabili,
// 1.000 "slot" di dimensioni interrogate al mese.
process.env.VECTORIZE_MAX_MEMORIZZATE = String(40 * 256);
process.env.VECTORIZE_MAX_INTERROGATE = String(1000 * 256);

let fallimenti = 0;
const verifica = (c: unknown, m: string) => {
  console.log(`  ${c ? "✓" : "✗"} ${m}`);
  if (!c) fallimenti++;
};

/* ------------------------------ Cloudflare simulato ------------------------------ */
const rete = { embedding: 0, input: 0, upsert: 0, query: 0, cancellati: 0, chat: 0 };
const indice = { dimensions: 256, extra: 0, vettori: new Map<string, number[]>() };
const ok = (result: unknown) => new Response(JSON.stringify({ success: true, result }), { status: 200, headers: { "content-type": "application/json" } });

/** Embedding "lessicale" deterministico: parole -> 256 dimensioni normalizzate. */
function vettoreDi(testo: string, dims: number): number[] {
  const v = new Array(dims).fill(0);
  const pulito = testo.replace(/^task: search result \| query: |^title: .*? \| text: /, "").toLowerCase();
  for (const p of pulito.match(/[a-zàèéìòù]{4,}/g) ?? []) {
    let h = 0;
    for (const c of p.slice(0, 7)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    v[h % dims] += 1;
  }
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.endsWith("/info")) return ok({ dimensions: indice.dimensions, vectorCount: indice.vettori.size + indice.extra });
  if (url.includes("/upsert")) {
    rete.upsert++;
    for (const riga of String(init?.body ?? "").split("\n").filter(Boolean)) {
      const v = JSON.parse(riga) as { id: string; values: number[] };
      indice.vettori.set(v.id, v.values);
    }
    return ok({ mutationId: "m" });
  }
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  if (url.includes("/delete_by_ids")) {
    for (const id of body.ids as string[]) if (indice.vettori.delete(id)) rete.cancellati++;
    return ok({ mutationId: "d" });
  }
  if (url.includes("/query")) {
    rete.query++;
    const q = body.vector as number[];
    const matches = [...indice.vettori.entries()]
      .map(([id, v]) => ({ id, score: v.reduce((s, x, i) => s + x * q[i], 0) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, body.topK);
    return ok({ matches });
  }
  if (url.includes("embeddinggemma")) {
    rete.embedding++;
    const testi = body.input as string[];
    rete.input += testi.length;
    return ok({
      object: "list",
      data: testi.map((t, index) => ({ object: "embedding", index, embedding: vettoreDi(t, body.dimensions) })),
      usage: { prompt_tokens: testi.reduce((s, t) => s + Math.ceil(t.length / 4), 0) },
    });
  }
  if (url.includes("reranker")) return ok({ response: (body.contexts as unknown[]).map((_, i) => ({ id: i, score: 1 - i / 100 })) });
  rete.chat++;
  return ok({ response: "La domanda di voltura si presenta online [1].", usage: { prompt_tokens: 800, completion_tokens: 40 } });
}) as typeof fetch;

/* ------------------------------ Corpus di prova ------------------------------ */
const paragrafo = (tema: string, i: number) =>
  `Articolo ${i}. Disposizioni sulla ${tema} catastale: la domanda di ${tema} si presenta all'ufficio provinciale del territorio entro trenta giorni, con gli allegati previsti dal provvedimento e la ricevuta dei tributi speciali catastali.`;

async function main() {
  const { getDb } = await import("../lib/db");
  const db = getDb();
  await db.execute(`CREATE TABLE documenti (id INTEGER PRIMARY KEY, cartella_origine TEXT, nuovo_nome_file TEXT, anno INTEGER, titolo TEXT, tema TEXT, testo_estratto TEXT)`);
  await db.executeMultiple(fs.readFileSync(path.join(process.cwd(), "sql", "fts5_setup.sql"), "utf8"));
  const inserisci = (id: number, cartella: string, anno: number, titolo: string, testo: string) =>
    db.execute({ sql: `INSERT INTO documenti (id, cartella_origine, nuovo_nome_file, anno, titolo, tema, testo_estratto) VALUES (?, ?, ?, ?, ?, '', ?)`, args: [id, cartella, `${anno} - ${titolo}.pdf`, anno, titolo, testo] });
  const volture = Array.from({ length: 14 }, (_, i) => paragrafo("voltura", i + 1)).join("\n\n");
  await inserisci(1, "19 - Provvedimenti", 2025, "Prov. 1 - Domande di voltura online", volture);
  await inserisci(2, "02 - Circolari", 2010, "Circ. 9 - Redditi fondiari", "Redditi fondiari e rendita catastale ai fini IRPEF: la rendita dei fabbricati si rivaluta del cinque per cento. ".repeat(4));
  await inserisci(3, "02 - Circolari", 2010, "Circ. 9 - Redditi fondiari (copia)", "Redditi fondiari e rendita catastale ai fini IRPEF: la rendita dei fabbricati si rivaluta del cinque per cento. ".repeat(4));
  await inserisci(4, "16 - Manuali", 2019, "Manuale Docfa", Array.from({ length: 300 }, (_, i) => paragrafo("dichiarazione Docfa", i + 1)).join("\n"));
  await inserisci(5, "20 - Risoluzioni", 2021, "Ris. 5 - Simboli", `Formula 𝐀 per la rendita: 𝑅 = 𝑉 × 𝑟.\n\n${paragrafo("classamento", 1)}\n\n𝐁 fine del testo 😀 ${paragrafo("classamento", 2)}`);
  await inserisci(6, "02 - Circolari", 2001, "Circ. 1 - Breve", "Testo troppo breve.");
  const { assicuraSchemaMetadati } = await import("../lib/metadati/bonifica");
  await assicuraSchemaMetadati(db);
  await db.execute(`INSERT INTO documenti_meta (doc_id, duplicato_di, revisione, aggiornato_il) VALUES (3, 2, 1, '2026-11-26')`);

  const pz = await import("../lib/ai/passaggi");
  const ix = await import("../lib/ai/indice");
  const vz = await import("../lib/ai/vectorize");
  const budget = await import("../lib/ai/budget");
  const cf = await import("../lib/cloudflare");

  console.log("\n# Modello e passaggi");
  verifica(cf.EMBEDDING_MODEL === "@cf/google/embeddinggemma-2" && cf.EMBEDDING_DIMS === 256, `EmbeddingGemma-2 a 256 dimensioni (${cf.EMBEDDING_MODEL}, ${cf.EMBEDDING_DIMS})`);
  const p1 = pz.spezzaInPassaggi(volture);
  verifica(p1.length >= 2 && p1.every((p) => p.lunghezza <= pz.PASSAGGIO_MAX), `passaggi entro ${pz.PASSAGGIO_MAX} caratteri (${p1.length})`);
  const ricucito = p1.map((p) => pz.ritaglio(volture, p)).join(" ").replace(/\s+/g, "");
  verifica(ricucito === volture.replace(/\s+/g, ""), "i passaggi coprono tutto il testo, senza sovrapposizioni");
  verifica(p1.every((p) => /[.\n]$|\.$/.test(pz.ritaglio(volture, p).trimEnd()) || p === p1[p1.length - 1]), "tagli a fine paragrafo o frase");
  const simboli = (await db.execute(`SELECT testo_estratto FROM documenti WHERE id = 5`)).rows[0].testo_estratto as string;
  const ps = pz.spezzaInPassaggi(simboli, 300, 150);
  let uguali = true;
  for (const p of ps) {
    const r = await db.execute({ sql: `SELECT substr(testo_estratto, ?, ?) AS t FROM documenti WHERE id = 5`, args: [p.inizio + 1, p.lunghezza] });
    if (String(r.rows[0].t) !== pz.ritaglio(simboli, p)) uguali = false;
  }
  verifica(ps.length >= 2 && uguali, `offset in code point identici a substr() di SQLite anche con 𝐀 e 😀 (${ps.length} passaggi)`);
  const scelti = pz.selezionaPassaggi(Array.from({ length: 100 }, (_, i) => i), 10);
  verifica(scelti.length === 10 && scelti[0] === 0 && scelti[9] === 99, `selezione uniforme con il primo passaggio (${scelti.join(",")})`);
  const k = pz.tettoPerDocumento([2, 1, 59], 32);
  verifica(k === 29 && pz.tettoPerDocumento([2, 1, 5], 32) === 0, `tetto per documento a riempimento (k = ${k})`);
  const piano = ix.calcolaPiano([{ id: 1, caratteri: 3_000 }, { id: 2, caratteri: 500 }, { id: 4, caratteri: 100_000 }]);
  verifica(piano.tettoVettori === 40 && piano.budgetVettori === 32 && piano.vettoriPrevisti <= piano.budgetVettori, `piano entro l'82% del tetto (${piano.vettoriPrevisti}/${piano.budgetVettori} su ${piano.tettoVettori})`);

  console.log("\n# Vecchio indice da 1.024 dimensioni");
  indice.dimensions = 1024;
  vz._azzeraPerTest();
  const vecchio = await ix.indicizzaDocumenti(db);
  verifica(/va ricreato/.test(vecchio.arresto ?? "") && rete.embedding === 0, `nessun embedding finché l'indice non è ricreato (${vecchio.arresto})`);
  verifica(!(await vz.prenotaQueryVectorize()) && rete.query === 0, "nessuna query sul vecchio indice");
  indice.dimensions = 256;
  vz._azzeraPerTest();

  console.log("\n# Ricostruzione a lotti");
  const fermo = await ix.indicizzaDocumenti(db, { maxNeuroni: 0.00001 });
  verifica(fermo.documenti === 0 && /budget/.test(fermo.arresto ?? "") && rete.embedding === 0, `budget minimo: si ferma prima di spendere (${fermo.arresto})`);
  const senzaTempo = await ix.indicizzaDocumenti(db, { budgetMs: 0 });
  verifica(senzaTempo.documenti === 0 && /tempo/.test(senzaTempo.arresto ?? ""), "tempo esaurito: si ferma e riprende dopo");
  verifica(!(await vz.prenotaQueryVectorize()), "ricostruzione non finita: ricerca semantica ancora spenta");
  const tutto = await ix.indicizzaDocumenti(db);
  const vettoriTurso = Number((await db.execute(`SELECT COALESCE(SUM(vettori), 0) AS v FROM vectorize_documenti`)).rows[0].v);
  verifica(tutto.completata && tutto.residui === 0 && tutto.documenti === 4, `ricostruzione completa: 4 documenti (${tutto.documenti}, arresto: ${tutto.arresto ?? "nessuno"})`);
  verifica(indice.vettori.size === vettoriTurso && vettoriTurso <= 40, `vettori su Vectorize = passaggi su Turso, entro il tetto (${indice.vettori.size}/40)`);
  verifica(![...indice.vettori.keys()].some((id) => /^(3|6)-/.test(id)), "doppione esatto e testo troppo breve esclusi");
  const manuale = Number((await db.execute(`SELECT vettori FROM vectorize_documenti WHERE doc_id = 4`)).rows[0].vettori);
  verifica(manuale < 60 && indice.vettori.has("4-0"), `manuale lungo con passaggi limitati e distribuiti (${manuale})`);
  const s = await budget.statoBudget();
  verifica(tutto.neuroni > 0 && s.perServizio.cron > 0 && Math.abs(s.perServizio.cron - tutto.neuroni) < 0.05, `neuroni contati nel budget del giorno (${tutto.neuroni} ≈ ${s.perServizio.cron})`);
  const stima = budget.neuroni("@cf/google/embeddinggemma-2", 1_000_000, 0);
  verifica(stima === 154, `tariffa EmbeddingGemma-2: 154 neuroni per milione di token (${stima})`);

  console.log("\n# Idempotenza, modifiche, rimozioni");
  const embPrima = rete.embedding;
  const ancora = await ix.indicizzaDocumenti(db);
  verifica(ancora.documenti === 0 && rete.embedding === embPrima, "seconda esecuzione: nulla da rifare, nessuna chiamata AI");
  await db.execute({ sql: `UPDATE documenti SET testo_estratto = ? WHERE id = 1`, args: [paragrafo("voltura", 1)] });
  const cambiato = await ix.indicizzaDocumenti(db);
  verifica(cambiato.documenti === 1 && indice.vettori.has("1-0") && !indice.vettori.has("1-1"), "documento cambiato: reindicizzato, passaggi vecchi cancellati");
  await db.execute(`INSERT INTO documenti_meta (doc_id, duplicato_di, revisione, aggiornato_il) VALUES (5, 2, 1, '2026-11-27') ON CONFLICT(doc_id) DO UPDATE SET duplicato_di = 2`);
  const { _azzeraCacheMetadati } = await import("../lib/metadati/bonifica");
  _azzeraCacheMetadati();
  const rimosso = await ix.indicizzaDocumenti(db);
  verifica(rimosso.rimossi === 1 && ![...indice.vettori.keys()].some((id) => id.startsWith("5-")), "documento diventato doppione: tolto dall'indice");

  console.log("\n# Tetti Vectorize");
  pz.invalidaRiepilogo();
  vz._azzeraPerTest();
  const sv = await vz.statoVectorize();
  verifica(sv.consentito && sv.indice.pronto && sv.tettoMemorizzate === 40 * 256, `indice completo: ricerca semantica attiva (${sv.motivo})`);
  verifica(await vz.prenotaQueryVectorize(), "query prenotata");
  const sv2 = await vz.statoVectorize();
  verifica(sv2.queryMese === 1 && sv2.interrogateMese === (1 + sv2.vettori) * 256 && sv2.maxQueryMese === 1000 - sv2.vettori, `dimensioni interrogate del mese, conteggio prudente (${sv2.interrogateMese})`);
  await db.execute({ sql: `UPDATE vectorize_uso SET query = ?`, args: [sv2.maxQueryMese - 1] });
  verifica(await vz.prenotaQueryVectorize(), "ultima query entro il tetto mensile");
  const qPrima = rete.query;
  verifica(!(await vz.prenotaQueryVectorize()) && rete.query === qPrima, "tetto mensile raggiunto: niente query (ricerca testuale)");
  const sv3 = await vz.statoVectorize();
  verifica(!sv3.consentito && /Tetto mensile/.test(sv3.motivo) && sv3.bloccateMese >= 1, "stato: tetto mensile raggiunto, query passate al testuale");
  await db.execute(`UPDATE vectorize_uso SET query = 0, bloccate = 0`);
  indice.extra = 100;
  vz._azzeraPerTest();
  verifica(!(await vz.spazioPerNuoviVettori(1)).ok, "oltre il tetto di dimensioni memorizzate: nessun upsert");
  await inserisci(7, "19 - Provvedimenti", 2026, "Prov. 7 - Nuovo atto", Array.from({ length: 3 }, (_, i) => paragrafo("voltura", i + 1)).join("\n\n"));
  const pieno = await ix.indicizzaDocumenti(db);
  verifica(pieno.documenti === 0 && /tetto/.test(pieno.arresto ?? ""), `nuovo atto senza spazio: rimandato (${pieno.arresto})`);
  verifica(!(await vz.prenotaQueryVectorize()), "indice oltre il tetto: niente query");
  indice.extra = 0;
  vz._azzeraPerTest();

  console.log("\n# Normie: passaggi da Turso, canale semantico + testuale");
  const testi = await pz.testiPassaggi(db, ["1-0", "4-0"]);
  verifica(testi.get("1-0")?.titolo === "Prov. 1 - Domande di voltura online" && /voltura/.test(testi.get("1-0")?.testo ?? ""), "testo e titolo correnti dei passaggi da Turso");
  const { POST } = await import("../app/api/normie/route");
  const { NextRequest } = await import("next/server");
  const r = await POST(new NextRequest("http://localhost/api/normie", { method: "POST", body: JSON.stringify({ message: "Come si presenta la domanda di voltura?" }), headers: { "content-type": "application/json", "x-forwarded-for": "10.2.2.2" } }));
  const j = (await r.json()) as { answer: string; sources: Array<{ titolo: string }> };
  verifica(r.status === 200 && rete.query === qPrima + 1 && j.sources.some((f) => /voltura/i.test(f.titolo)), `risposta con fonte, una query Vectorize (${j.sources.map((f) => f.titolo).join("; ")})`);

  console.log(fallimenti === 0 ? "\nTUTTI I CONTROLLI SUPERATI" : `\n${fallimenti} CONTROLLI FALLITI`);
  process.exit(fallimenti === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
