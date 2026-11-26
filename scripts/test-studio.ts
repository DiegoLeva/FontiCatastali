/**
 * Prova end-to-end LOCALE dello Studio Normativo, senza rete.
 *
 *   npx tsx scripts/test-studio.ts
 *
 * Corpus sintetico su libSQL (schema FTS di produzione) + Cloudflare simulato
 * (embedding, Vectorize, JSON mode, streaming SSE). Il modello simulato
 * inserisce di proposito una citazione inesistente [F999] e una legge
 * inventata: le verifiche anti-allucinazione devono intercettarle. Passa per
 * la route HTTP reale (stream NDJSON + cache).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fc-studio-")), "test.db");
process.env.TURSO_DATABASE_URL = `file:${dbFile}`;
process.env.CF_ACCOUNT_ID = "acc-prova";
process.env.CF_API_TOKEN = "token-prova";
process.env.CF_VECTORIZE_INDEX = "indice-prova";

let fallimenti = 0;
const verifica = (c: unknown, m: string) => {
  console.log(`  ${c ? "✓" : "✗"} ${m}`);
  if (!c) fallimenti++;
};

const CORPUS: Array<[number, string, string, number, string, string]> = [
  [1, "15 - Massimari", "1939 - Massimario - Volture catastali", 1939, "Massimario volture", "Le volture catastali sono disposte dagli uffici in base agli atti traslativi. La domanda di voltura e' presentata dalle parti entro trenta giorni (L. 1249/1939 art. 3)."],
  [2, "12 - Leggi", "1972 - DPR 650 - Perfezionamento catasto", 1972, "DPR 650/1972", "Il D.P.R. 26 ottobre 1972, n. 650 disciplina la domanda di voltura e la conservazione del catasto. Le volture si eseguono a domanda di parte."],
  [3, "02 - Circolari", "1986 - Circ. 2 - Voltura catastale meccanizzata", 1986, "Circ. 2", "La circolare n. 2 del 1986 introduce la procedura meccanizzata per le volture catastali e il modello 98T per la domanda di voltura."],
  [4, "02 - Circolari", "2005 - Circ. 1 - Voltura e successioni", 2005, "Circ. 1", "Con la dichiarazione di successione telematica si avvia la voltura automatica delle intestazioni catastali; mutazione soggettiva e aggiornamento intestazioni."],
  [5, "19 - Provvedimenti", "2015 - Prov. 32970 - Voltura 2.0", 2015, "Prov.", "Il provvedimento approva il software Voltura 2.0 per la presentazione telematica della domanda di voltura catastale."],
  [6, "19 - Provvedimenti", "2025 - Prov. 153452 - Presentazione domande di volture catastali online", 2025, "Prov.", "Dal 2025 la domanda di voltura catastale si presenta online tramite il servizio web: la voltura 2.0 resta disponibile per i professionisti."],
  [7, "17 - Note", "2010 - Nota 1234 - Intestazioni catastali", 2010, "Nota", "La nota chiarisce l'aggiornamento delle intestazioni catastali e la riunione di usufrutto ai fini della voltura."],
  [8, "02 - Circolari", "2018 - Circ. 4 - Imposta di registro", 2018, "Circ. 4", "Imposta di registro sui trasferimenti; cenno marginale: resta ferma la voltura catastale a carico delle parti."],
  [9, "02 - Circolari", "2020 - Circ. 9 - IRPEF redditi fondiari", 2020, "Circ. 9", "Redditi fondiari e rendita catastale ai fini IRPEF. Nessun riferimento alle procedure catastali di aggiornamento soggettivo."],
  [10, "04 - Convegni e slide", "2023 - Slide - Voltura catastale di immobili", 2023, "Slide", "Slide formative: la voltura catastale, la domanda di voltura, Voltura 2.0 e i casi di mutazione soggettiva."],
];

/* --------------------------- Cloudflare simulato ------------------------- */
function sse(pezzi: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      // Formato reale di Workers AI: delta.content e' sempre stringa, mentre
      // `response` diventa un NUMERO sui frammenti di sole cifre (" 1949" -> 1949).
      for (const p of pezzi) {
        const response = /^\s*\d+\s*$/.test(p) ? Number(p) : p;
        c.enqueue(enc.encode(`data: ${JSON.stringify({ response, choices: [{ index: 0, delta: { content: p } }] })}\n\n`));
      }
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}
const ok = (result: unknown) => new Response(JSON.stringify({ success: true, result }), { status: 200, headers: { "content-type": "application/json" } });

let chiamateAi = 0;
// Quota giornaliera gratuita esaurita: risposta reale di Workers AI (429/4006).
let quotaFinita = false;
let chiamateQuota = 0;
const RISPOSTA_QUOTA = JSON.stringify({
  success: false,
  result: null,
  messages: [],
  errors: [{ code: 4006, message: "AiError: you have used up your daily free allocation of 10,000 neurons, please upgrade to Cloudflare's Workers Paid plan if you would like to continue usage." }],
});
const fetchOriginale = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (!url.startsWith("https://api.cloudflare.com/")) return fetchOriginale(input, init);
  if (quotaFinita && url.includes("/ai/run/")) {
    chiamateQuota++;
    return new Response(RISPOSTA_QUOTA, { status: 429, headers: { "content-type": "application/json" } });
  }
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  if (url.includes("/vectorize/")) return ok({ matches: [{ id: "4-0", score: 0.71 }, { id: "7-1", score: 0.66 }, { id: "9-0", score: 0.4 }] });
  if (url.includes("bge-m3")) return ok({ data: (body.text as string[]).map(() => Array.from({ length: 8 }, () => 0.1)) });
  chiamateAi++;
  const prompt: string = (body.messages ?? []).map((m: { content: string }) => m.content).join("\n");
  if (body.stream) {
    const nums = [...new Set([...prompt.matchAll(/\[F(\d+)\]/g)].map((m) => Number(m[1])))];
    const testo = `La voltura aggiorna l'intestazione catastale [F${nums[0]}], come previsto dal regolamento del 9 luglio 1905. ${nums.slice(1).map((n) => `Successivamente la fonte [F${n}] precisa la disciplina.`).join(" ")} Secondo la legge n. 4321/1999 [F999] tutto cambia.`;
    // Frammenti come quelli reali: le cifre arrivano da sole (" 9", " 1905").
    return sse(testo.split(/(?=\s\d)|(?<=\d)(?=\s)/).flatMap((p) => p.match(/.{1,40}/gs) ?? [p]));
  }
  if (/termini/.test(prompt) && /terminologia/.test(prompt)) return ok({ response: { termini: ["voltura catastale", "modello 98T", "termine inesistente xyz"] } });
  const nums = [...prompt.matchAll(/^\[F(\d+)\]/gm)].map((m) => Number(m[1]));
  return ok({
    response: {
      documenti: nums.map((n, i) => ({
        f: n,
        estremi: i === 0 ? "Circolare n. 77777 del 1901" : "",
        ruolo: i === 0 ? "istitutivo" : "chiarimento",
        stato: "vigente",
        sintesi: `Sintesi della fonte ${n} sulla voltura.`,
        novita: i === 0 ? "Introduce la domanda di voltura." : "",
        rinvii: ["L. 1249/1939, art. 3", "D.L. 9999/2099"],
      })),
    },
  });
}) as typeof fetch;

async function main() {
  const { createClient } = await import("@libsql/client");
  const db = createClient({ url: `file:${dbFile}` });
  await db.execute(`CREATE TABLE documenti (id INTEGER PRIMARY KEY, cartella_origine TEXT, nuovo_nome_file TEXT, anno INTEGER, titolo TEXT, tema TEXT, testo_estratto TEXT)`);
  await db.executeMultiple(fs.readFileSync(path.join(process.cwd(), "sql", "fts5_setup.sql"), "utf8"));
  for (const [id, cartella, nome, anno, tema, testo] of CORPUS) {
    await db.execute({
      sql: `INSERT INTO documenti (id, cartella_origine, nuovo_nome_file, anno, titolo, tema, testo_estratto) VALUES (?,?,?,?,?,?,?)`,
      args: [id, cartella, `${nome}.pdf`, anno, nome.replace(/^\d{4} - /, ""), tema, testo],
    });
  }

  const { POST, GET } = await import("../app/api/studio/route");
  const { NextRequest } = await import("next/server");

  const leggi = async (res: Response) => {
    const eventi: Array<Record<string, unknown>> = [];
    const testo = await res.text();
    for (const r of testo.split("\n")) if (r.trim()) eventi.push(JSON.parse(r));
    return eventi;
  };
  const richiesta = (body: unknown) =>
    new NextRequest("http://localhost/api/studio", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.1" } });

  console.log("\n# Generazione (stream NDJSON)");
  const t0 = Date.now();
  const res = await POST(richiesta({ argomento: "volture" }));
  verifica(res.headers.get("content-type")?.includes("ndjson"), "risposta NDJSON");
  const eventi = await leggi(res);
  const tipi = eventi.map((e) => e.tipo);
  console.log(`  (${eventi.length} eventi in ${Date.now() - t0} ms, ${chiamateAi} chiamate al modello simulato)`);
  verifica(tipi.indexOf("espansione") < tipi.indexOf("fonti") && tipi.indexOf("fonti") < tipi.indexOf("note"), "ordine: espansione → fonti → note");
  verifica(tipi.indexOf("note") < tipi.indexOf("sezione_inizio") && tipi.lastIndexOf("delta") < tipi.lastIndexOf("fine"), "ordine: note → stesura → fine");
  const fine = eventi.find((e) => e.tipo === "fine") as { dossier: import("../lib/studio/tipi").Dossier } | undefined;
  verifica(!!fine, "evento finale con il dossier");
  if (!fine) process.exit(1);
  const d = fine.dossier;

  const ids = d.fonti.map((f) => f.id);
  verifica(ids.includes(1) && ids.includes(6), "trovate la fonte più antica (1939) e la più recente (2025)");
  verifica(!ids.includes(9), "esclusa la circolare IRPEF senza nesso (score semantico basso)");
  verifica(d.fonti[0].anno === "1939" && d.fonti[0].n === 1, "numerazione cronologica: F1 = 1939");
  verifica(d.espansione.some((c) => c.origine === "ai" && c.etichetta === "modello 98T"), "termine AI esistente nel corpus accettato");
  verifica(!d.espansione.some((c) => c.etichetta === "termine inesistente xyz"), "termine AI inesistente scartato");
  verifica(d.espansione.some((c) => c.etichetta === "Voltura 2.0" && c.documenti >= 2), "tesauro: Voltura 2.0 trovata");

  const ordine = ["inquadramento", "origini", "evoluzione", "vigente", "avvertenze"];
  verifica(ordine.every((id) => d.sezioni.some((s) => s.id === id)), "tutte le sezioni del manuale presenti");
  const testo = d.sezioni.map((s) => s.markdown).join("\n");
  verifica(!/F999/.test(testo), "citazione inventata [F999] rimossa");
  verifica(/del 9 luglio 1905/.test(testo) && !/luglio1905|del9/.test(testo), "spazi conservati prima dei numeri nello streaming (bug Workers AI)");
  verifica(d.verifiche.citazioniRimosse >= 1, `conteggio citazioni rimosse (${d.verifiche.citazioniRimosse})`);
  verifica(d.verifiche.riferimentiNonVerificati.some((r) => /4321/.test(r)), "legge inventata segnalata come non verificata");
  const analizzate = d.fonti.filter((f) => f.livello === "analizzata");
  verifica(analizzate.every((f) => f.nota && f.nota.sintesi), "ogni fonte analizzata ha la sua nota");
  verifica(analizzate.every((f) => f.nota!.estremi === ""), "estremi con numeri assenti dagli estratti scartati");
  verifica(analizzate.every((f) => !f.nota!.rinvii.some((r) => /9999/.test(r))), "rinvii inventati scartati");
  verifica(d.lacune.some((l) => /1249/.test(l.riferimento)), "L. 1249/1939 segnalata come norma richiamata ma assente dal DB");
  verifica(d.timeline.length === analizzate.length, "timeline: una voce per fonte analizzata");
  verifica(analizzate.every((f) => f.passaggi.length > 0), "estratti pertinenti per ogni fonte analizzata");

  console.log("\n# Cache");
  const chiamatePrima = chiamateAi;
  const res2 = await POST(richiesta({ argomento: "Voltura" }));
  const ev2 = await leggi(res2);
  verifica(ev2.some((e) => e.tipo === "fine" && e.cache === true), "stessa radice ('Voltura') servita dalla cache");
  verifica(chiamateAi === chiamatePrima, "nessuna chiamata al modello dalla cache");
  const rec = await (await GET(new NextRequest("http://localhost/api/studio?recenti=1"))).json();
  verifica(rec.recenti?.length === 1 && rec.recenti[0].argomento === "volture", "elenco dossier recenti");

  console.log("\n# Nuova normativa dopo la generazione");
  await db.execute({ sql: `INSERT INTO documenti (id, cartella_origine, nuovo_nome_file, anno, titolo, tema, testo_estratto) VALUES (11, '19 - Provvedimenti', 'https://www.agenziaentrate.gov.it/x.pdf', 2026, 'Prov. 1 - Nuove volture', '', 'Nuove regole per la voltura catastale telematica.')`, args: [] });
  const ev3 = await leggi(await POST(richiesta({ argomento: "volture" })));
  const f3 = ev3.find((e) => e.tipo === "fine") as { nuoveFonti?: number } | undefined;
  verifica(f3?.nuoveFonti === 1, `segnalata 1 nuova fonte pertinente (${f3?.nuoveFonti})`);

  console.log("\n# Codici di categoria (verifica della barra su FTS5 reale)");
  await db.execute({ sql: `INSERT INTO documenti (id, cartella_origine, nuovo_nome_file, anno, titolo, tema, testo_estratto) VALUES (21, '02 - Circolari', 'c.pdf', 2010, 'Circ. 4 - Unita in corso di costruzione', '', 'Le unita censite in categoria F/3 sono prive di rendita fino all''ultimazione.')`, args: [] });
  await db.execute({ sql: `INSERT INTO documenti (id, cartella_origine, nuovo_nome_file, anno, titolo, tema, testo_estratto) VALUES (22, '02 - Circolari', 'd.pdf', 2011, 'Circ. 5 - Altro', '', 'Si veda la lettera f) 3. del regolamento sulle imposte.')`, args: [] });
  const { espandiArgomento } = await import("../lib/studio/espansione");
  const { cercaConcetti } = await import("../lib/studio/recupero");
  const pianoF3 = espandiArgomento("Categoria F/3");
  const rF3 = await cercaConcetti(db, pianoF3.concetti.filter((c) => c.codice === "f/3"));
  verifica(rF3.candidati.has(21), "F/3 nel testo riconosciuto (evidenziazione «F/3» di FTS5)");
  verifica(!rF3.candidati.has(22) && rF3.scartatiCodice >= 1, "\"lettera f) 3.\" scartata dalla verifica della barra");

  console.log("\n# Quota giornaliera di Workers AI esaurita (errore 4006)");
  type Fine = { cache?: boolean; dossier?: import("../lib/studio/tipi").Dossier };
  const richiestaQ = (body: unknown) =>
    new NextRequest("http://localhost/api/studio", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", "x-forwarded-for": "10.0.0.2" } });
  quotaFinita = true;
  const evQ1 = await leggi(await POST(richiestaQ({ argomento: "volture", rigenera: true })));
  const fQ1 = evQ1.find((e) => e.tipo === "fine") as Fine | undefined;
  verifica(evQ1.some((e) => e.tipo === "avviso" && e.grave === true && /quota/i.test(String(e.messaggio))), "avviso grave sulla quota esaurita");
  verifica(fQ1?.cache === true && !!fQ1.dossier?.sezioni.some((s) => s.id === "inquadramento"), "\"Rigenera\" con quota esaurita: resta la versione completa salvata");
  const evQ2 = await leggi(await POST(richiestaQ({ argomento: "intestazioni catastali" })));
  const fQ2 = evQ2.find((e) => e.tipo === "fine") as Fine | undefined;
  const dQ2 = fQ2?.dossier;
  verifica(fQ2?.cache === false && (dQ2?.fonti.length ?? 0) > 0, `senza cache: fonti comunque elencate (${dQ2?.fonti.length ?? 0})`);
  verifica(dQ2?.sezioni.length === 1 && dQ2.sezioni[0].id === "avvertenze", "nessun capitolo tentato: resta la sezione deterministica");
  verifica(!!dQ2 && dQ2.fonti.filter((f) => f.livello === "analizzata").every((f) => f.nota?.automatica), "note estratte dal testo, senza modello");
  verifica(chiamateQuota <= 3, `chiamate al modello sospese dopo il primo errore (${chiamateQuota} tentativi in rete per 2 dossier)`);
  const salvatoQ2 = await GET(new NextRequest(`http://localhost/api/studio?argomento=${encodeURIComponent("intestazioni catastali")}`));
  verifica(salvatoQ2.status === 404, "dossier senza capitoli non salvato in cache");
  quotaFinita = false;

  console.log("\n# Validazione e limiti");
  const bad = await POST(richiesta({ argomento: " " }));
  verifica(bad.status === 400, "argomento vuoto rifiutato (400)");
  let ultimo = 200;
  for (let i = 0; i < 6; i++) ultimo = (await POST(richiesta({ argomento: `tema di prova ${i}`, rigenera: true }))).status;
  verifica(ultimo === 429, `rate limit per IP sulle generazioni (status ${ultimo})`);

  globalThis.fetch = fetchOriginale;
  console.log(fallimenti === 0 ? "\nTUTTI I CONTROLLI SUPERATI" : `\n${fallimenti} CONTROLLI FALLITI`);
  process.exit(fallimenti === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
