/**
 * Prova LOCALE del tetto di spesa AI e del guardiano Vectorize, senza rete.
 *
 *   npx tsx scripts/test-budget.ts
 *
 * Workers AI, Vectorize e GraphQL di Cloudflare sono simulati: si verifica che
 * le chiamate oltre il tetto NON partano (nessuna richiesta in rete), che la
 * riserva di Normie resti intatta, che saldi e rimborsi tornino, che la
 * prenotazione regga la concorrenza e che Normie funzioni senza Vectorize.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fc-budget-")), "test.db");
process.env.TURSO_DATABASE_URL = `file:${dbFile}`;
process.env.CF_ACCOUNT_ID = "acc-prova";
process.env.CF_API_TOKEN = "token-prova";
process.env.CF_VECTORIZE_INDEX = "indice-prova";
process.env.CF_D1_DATABASE_ID = "d1-prova";
// Tetto piccolo per provare i limiti: 1.000 al giorno, 300 riservati (Studio: 700).
process.env.AI_NEURONI_GIORNO = "1000";
process.env.AI_NEURONI_RISERVA = "300";
process.env.AI_SEED_INSTALLAZIONE = "0";
process.env.AI_SYNC_REMOTA = "0";

let fallimenti = 0;
const verifica = (c: unknown, m: string) => {
  console.log(`  ${c ? "✓" : "✗"} ${m}`);
  if (!c) fallimenti++;
};

/* ------------------------------ Cloudflare simulato ------------------------------ */
const rete = { ai: 0, vectorizeQuery: 0, embedding: 0, graphql: 0 };
let indice = { dimensions: 1024, vectorCount: 56_011 };
let remoto = 0;
const ok = (result: unknown) => new Response(JSON.stringify({ success: true, result }), { status: 200, headers: { "content-type": "application/json" } });

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.endsWith("/graphql")) {
    rete.graphql++;
    return new Response(JSON.stringify({ data: { viewer: { accounts: [{ aiInferenceAdaptiveGroups: [{ sum: { totalNeurons: remoto } }] }] } } }), { status: 200 });
  }
  if (url.endsWith("/info")) return ok(indice);
  if (url.includes("/vectorize/")) {
    rete.vectorizeQuery++;
    return ok({ matches: [] });
  }
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  if (url.includes("bge-m3")) {
    rete.embedding++;
    return ok({ data: (body.text as string[]).map(() => [0.1, 0.2]) });
  }
  if (url.includes("reranker")) return ok({ response: (body.contexts as unknown[]).map((_, i) => ({ id: i, score: 1 - i / 100 })) });
  rete.ai++;
  const prompt: string = (body.messages ?? []).map((m: { content: string }) => m.content).join("\n");
  if (prompt.includes("RIFIUTA")) return new Response(JSON.stringify({ success: false, errors: [{ code: 5006, message: "input non valido" }] }), { status: 400 });
  if (prompt.includes("RETE")) throw new TypeError("fetch failed");
  return ok({ response: "La domanda di voltura si presenta online [1].", usage: { prompt_tokens: 1000, completion_tokens: 100 } });
}) as typeof fetch;

async function main() {
  const budget = await import("../lib/ai/budget");
  const cf = await import("../lib/cloudflare");
  const vz = await import("../lib/ai/vectorize");
  const { getDb } = await import("../lib/db");
  const db = getDb();
  const MODELLO = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
  const domanda = (testo: string) => [{ role: "user" as const, content: testo }];
  const usati = async () => (await budget.statoBudget()).usati;

  console.log("\n# Prenotazione e saldo");
  verifica(budget.LIMITE_GIORNO === 1000 && budget.LIMITE_STUDIO === 700, `tetti letti dall'ambiente (${budget.LIMITE_GIORNO} / studio ${budget.LIMITE_STUDIO})`);
  await budget.conServizioAi("studio", () => cf.chat(domanda("Ciao"), { model: MODELLO, maxTokens: 2000 }));
  const atteso = Math.round(budget.neuroni(MODELLO, 1000, 100) * budget.MARGINE * 100) / 100;
  verifica(Math.abs((await usati()) - atteso) < 0.02, `saldo sui token reali +15% (${await usati()} ≈ ${atteso})`);

  const primaRifiuto = await usati();
  await budget.conServizioAi("normie", () => cf.chat(domanda("RIFIUTA"), { model: MODELLO, maxTokens: 500 })).catch(() => undefined);
  verifica(Math.abs((await usati()) - primaRifiuto) < 0.02, "richiesta rifiutata (4xx): prenotazione rimborsata");

  const primaRete = await usati();
  await budget.conServizioAi("normie", () => cf.chat(domanda("RETE"), { model: MODELLO, maxTokens: 500 })).catch(() => undefined);
  const prenotataRete = budget.neuroni(MODELLO, budget.stimaToken("RETE".length + 16), 500) * budget.MARGINE;
  verifica((await usati()) - primaRete >= prenotataRete - 0.05, "errore di rete: prenotazione trattenuta per prudenza");

  console.log("\n# Tetto dello Studio e riserva di Normie");
  const reteStudioPrima = rete.ai;
  let bloccata: unknown = null;
  let riuscite = 0;
  for (let i = 0; i < 40 && !bloccata; i++) {
    try {
      await budget.conServizioAi("studio", () => cf.chat(domanda(`Domanda ${i}`), { model: MODELLO, maxTokens: 1500 }));
      riuscite++;
    } catch (err) {
      bloccata = err;
    }
  }
  const s1 = await budget.statoBudget();
  verifica(bloccata instanceof budget.BudgetAiEsaurito && (bloccata as InstanceType<typeof budget.BudgetAiEsaurito>).ambito === "studio", `lo Studio si ferma al suo tetto dopo ${riuscite} chiamate`);
  verifica(s1.usati <= budget.LIMITE_STUDIO + 0.01, `consumo sotto il tetto dello Studio (${s1.usati} ≤ ${budget.LIMITE_STUDIO})`);
  verifica(rete.ai - reteStudioPrima === riuscite, "la chiamata bloccata non è partita (nessuna richiesta in rete)");
  verifica(cf.quotaEsaurita(bloccata), "il blocco è riconosciuto come quota esaurita (messaggi già pronti)");

  const risposta = await budget.conServizioAi("normie", () => cf.chat(domanda("Normie usa la riserva"), { model: MODELLO, maxTokens: 300 }));
  verifica(risposta.length > 0, "Normie risponde anche con lo Studio esaurito (riserva protetta)");
  let normieBloccata = false;
  for (let i = 0; i < 40 && !normieBloccata; i++) {
    try {
      await budget.conServizioAi("normie", () => cf.chat(domanda(`N ${i}`), { model: MODELLO, maxTokens: 1500 }));
    } catch (err) {
      normieBloccata = err instanceof budget.BudgetAiEsaurito;
    }
  }
  const s2 = await budget.statoBudget();
  verifica(normieBloccata && s2.usati <= budget.LIMITE_GIORNO + 0.01, `anche Normie si ferma al tetto globale (${s2.usati} ≤ ${budget.LIMITE_GIORNO})`);
  verifica(s2.bloccate >= 2, `chiamate bloccate registrate (${s2.bloccate})`);

  console.log("\n# Concorrenza (prenotazione atomica)");
  await db.execute(`DELETE FROM ai_daily_usage`);
  const esiti = await Promise.allSettled(
    Array.from({ length: 25 }, () => budget.conServizioAi("normie", () => budget.prenota(MODELLO, 100 / budget.MARGINE)))
  );
  const accettate = esiti.filter((e) => e.status === "fulfilled").length;
  const s3 = await budget.statoBudget();
  verifica(accettate === 10 && s3.usati <= 1000.01, `25 prenotazioni simultanee da 100: accettate ${accettate}, totale ${s3.usati}`);

  console.log("\n# Tetto del singolo dossier");
  await db.execute(`DELETE FROM ai_daily_usage`);
  const tetto = { nome: "questo dossier", limite: 120, usati: 0 };
  let tettoErr: unknown = null;
  for (let i = 0; i < 10 && !tettoErr; i++) {
    try {
      await budget.conServizioAi("studio", () => cf.chat(domanda(`T ${i}`), { model: MODELLO, maxTokens: 200 }), tetto);
    } catch (err) {
      tettoErr = err;
    }
  }
  verifica(tettoErr instanceof budget.BudgetAiEsaurito && (tettoErr as InstanceType<typeof budget.BudgetAiEsaurito>).ambito === "dossier", `tetto del dossier rispettato (${Math.round(tetto.usati)}/${tetto.limite})`);

  console.log("\n# Giorno di installazione e consumo reale dell'account");
  await db.execute(`DROP TABLE ai_daily_usage`);
  await db.execute(`DROP TABLE ai_usage_log`);
  budget._azzeraPerTest();
  process.env.AI_SEED_INSTALLAZIONE = "1";
  const reteSeed = rete.ai;
  const seed = await budget.conServizioAi("normie", () => cf.chat(domanda("dopo l'installazione"))).catch((e) => e);
  verifica(seed instanceof budget.BudgetAiEsaurito && rete.ai === reteSeed, "primo giorno del contatore: quota considerata consumata, nessuna chiamata");
  verifica(/installazione/i.test((await budget.statoBudget()).nota ?? ""), "nota del seed visibile nello stato");

  await db.execute(`DELETE FROM ai_daily_usage`);
  budget._azzeraPerTest();
  process.env.AI_SYNC_REMOTA = "1";
  remoto = 960;
  const sync = await budget.statoBudget(true);
  verifica(rete.graphql === 1 && sync.remoto === 960 && sync.usati === 960, `allineamento al consumo reale di Cloudflare (${sync.usati})`);
  const dopoSync = await budget.conServizioAi("normie", () => cf.chat(domanda("x"), { model: MODELLO, maxTokens: 500 })).catch((e) => e);
  verifica(dopoSync instanceof budget.BudgetAiEsaurito, "con 960 neuroni già consumati dall'account la chiamata non parte");
  process.env.AI_SYNC_REMOTA = "0";
  await db.execute(`DELETE FROM ai_daily_usage`);
  budget._azzeraPerTest();

  console.log("\n# Guardiano Vectorize");
  indice = { dimensions: 1024, vectorCount: 56_011 };
  vz._azzeraPerTest();
  const sv = await vz.statoVectorize();
  verifica(!sv.consentito && sv.memorizzate === 56_011 * 1024, `indice reale (56.011 × 1024): ricerca semantica sospesa`);
  verifica(!(await vz.prenotaQueryVectorize()) && rete.vectorizeQuery === 0, "nessuna query inviata");
  verifica(!(await vz.spazioPerNuoviVettori(10)).ok, "nessun nuovo vettore oltre i 10 M memorizzati inclusi");
  indice = { dimensions: 1024, vectorCount: 1000 };
  vz._azzeraPerTest();
  verifica(await vz.prenotaQueryVectorize(), "indice piccolo: query consentita");
  const sv2 = await vz.statoVectorize();
  verifica(sv2.queryMese === 1 && sv2.maxQueryMese === Math.floor((0.9 * 50_000_000) / 1024) - 1000, `contatore mensile delle query (${sv2.queryMese}/${sv2.maxQueryMese})`);

  console.log("\n# Normie senza Vectorize (ricerca testuale)");
  indice = { dimensions: 1024, vectorCount: 56_011 };
  vz._azzeraPerTest();
  await db.execute(`CREATE TABLE documenti (id INTEGER PRIMARY KEY, cartella_origine TEXT, nuovo_nome_file TEXT, anno INTEGER, titolo TEXT, tema TEXT, testo_estratto TEXT)`);
  await db.executeMultiple(fs.readFileSync(path.join(process.cwd(), "sql", "fts5_setup.sql"), "utf8"));
  await db.execute({
    sql: `INSERT INTO documenti VALUES (1, '19 - Provvedimenti', '2025 - Prov. 1 - Volture online.pdf', 2025, 'Prov. 1 - Domande di voltura online', '', ?)`,
    args: ["Dal 2025 la domanda di voltura catastale si presenta online tramite il servizio web dell'Agenzia, anche per le successioni."],
  });
  await db.execute({
    sql: `INSERT INTO documenti VALUES (2, '02 - Circolari', '2010 - Circ. 9 - IRPEF.pdf', 2010, 'Circ. 9 - Redditi fondiari', '', ?)`,
    args: ["Redditi fondiari e rendita catastale ai fini IRPEF."],
  });
  const { POST } = await import("../app/api/normie/route");
  const { NextRequest } = await import("next/server");
  const chiedi = (message: string) =>
    POST(new NextRequest("http://localhost/api/normie", { method: "POST", body: JSON.stringify({ message }), headers: { "content-type": "application/json", "x-forwarded-for": "10.1.1.1" } }));
  const embPrima = rete.embedding;
  const r1 = await chiedi("Come si presenta la domanda di voltura?");
  const j1 = (await r1.json()) as { answer: string; sources: Array<{ titolo: string }>; error?: string };
  verifica(r1.status === 200 && j1.sources.some((f) => /voltura/i.test(f.titolo)), `risposta con fonte trovata dalla ricerca testuale (${j1.sources.map((f) => f.titolo).join("; ")})`);
  verifica(rete.embedding === embPrima && rete.vectorizeQuery === 0, "nessun embedding né query Vectorize");

  await db.execute({ sql: `INSERT INTO ai_daily_usage (giorno, neuroni) VALUES (?, 1000) ON CONFLICT(giorno) DO UPDATE SET neuroni = 1000`, args: [budget.giornoUtc()] });
  const r2 = await chiedi("E per le successioni?");
  const j2 = (await r2.json()) as { error?: string };
  verifica(r2.status === 503 && /in pausa/i.test(j2.error ?? "") && r2.headers.get("retry-after"), "budget esaurito: Normie risponde 503 con messaggio di pausa e Retry-After");

  console.log(fallimenti === 0 ? "\nTUTTI I CONTROLLI SUPERATI" : `\n${fallimenti} CONTROLLI FALLITI`);
  process.exit(fallimenti === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
