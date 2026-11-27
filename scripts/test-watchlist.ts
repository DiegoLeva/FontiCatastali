/**
 * Prova LOCALE della watchlist degli argomenti (senza rete, senza AI).
 *
 *   npx tsx scripts/test-watchlist.ts
 *
 * Verifica il confronto argomento <-> nuovi atti (FTS + espansione dello
 * Studio, verifica della barra per i codici F/3), le novita' dalla data
 * dell'ultima visita, il registro anonimo e la segnalazione sui dossier in
 * cache dopo il cron.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fc-watch-")), "test.db");
process.env.TURSO_DATABASE_URL = `file:${dbFile}`;

let fallimenti = 0;
const verifica = (c: unknown, m: string) => {
  console.log(`  ${c ? "✓" : "✗"} ${m}`);
  if (!c) fallimenti++;
};

async function main() {
  const { getDb } = await import("../lib/db");
  const db = getDb();
  await db.execute(`CREATE TABLE documenti (id INTEGER PRIMARY KEY, cartella_origine TEXT, nuovo_nome_file TEXT, anno INTEGER, titolo TEXT, tema TEXT, testo_estratto TEXT)`);
  await db.executeMultiple(fs.readFileSync(path.join(process.cwd(), "sql", "fts5_setup.sql"), "utf8"));
  const docs: Array<[number, string, string, number, string, string]> = [
    [1, "02 - Circolari", "2005 - Circ. 1 - Volture.pdf", 2005, "Circ. 1 - Voltura e successioni", "La voltura catastale delle intestazioni a seguito di successione."],
    [10, "19 - Provvedimenti", "https://www.agenziaentrate.gov.it/a.pdf", 2026, "Prov. 1 - Domande di voltura online", "La domanda di voltura catastale si presenta con il nuovo servizio web."],
    [11, "02 - Circolari", "https://www.agenziaentrate.gov.it/b.pdf", 2026, "Circ. 9 - Unità in corso di costruzione", "Le unità censite nella categoria F/3 restano prive di rendita fino all'ultimazione."],
    [12, "20 - Risoluzioni", "https://www.agenziaentrate.gov.it/c.pdf", 2026, "Ris. 3 - Imposte di registro", "Si veda la lettera f) 3. del regolamento sulle imposte di registro."],
  ];
  for (const d of docs) await db.execute({ sql: `INSERT INTO documenti (id, cartella_origine, nuovo_nome_file, anno, titolo, tema, testo_estratto) VALUES (?,?,?,?,?, '', ?)`, args: d });

  const { assicuraSchema } = await import("../lib/aggiornamenti/archivio");
  await assicuraSchema(db);
  const voce = (url: string, docId: number, importato: string) =>
    db.execute({
      sql: `INSERT INTO aggiornamenti_voci (url, fonte, tipo, stato, doc_id, visto_il, aggiornato_il, importato_il) VALUES (?, 'ade', 'circolare', 'importato', ?, ?, ?, ?)`,
      args: [url, docId, importato, importato, importato],
    });
  await voce("https://www.agenziaentrate.gov.it/a.pdf", 10, "2026-11-30T05:01:00.000Z");
  await voce("https://www.agenziaentrate.gov.it/b.pdf", 11, "2026-11-30T05:02:00.000Z");
  await voce("https://www.agenziaentrate.gov.it/c.pdf", 12, "2026-10-01T05:02:00.000Z");

  const w = await import("../lib/watchlist/server");

  console.log("\n# Confronto argomento ↔ documenti");
  verifica((await w.documentiPerArgomento(db, "volture", [10, 11, 12])).join() === "10", "«volture» trova la domanda di voltura (radice + tesauro)");
  const f3 = await w.documentiPerArgomento(db, "F/3", [10, 11, 12]);
  verifica(f3.includes(11) && !f3.includes(12), `«F/3»: categoria trovata, "lettera f) 3." scartata (${f3.join(",")})`);
  verifica((await w.documentiPerArgomento(db, "fotovoltaico", [10, 11, 12])).length === 0, "argomento senza atti nuovi: nessuna corrispondenza");

  console.log("\n# Novità dalla data dell'ultima visita");
  const nov = await w.novitaPerArgomenti(db, ["volture", "F/3"], "2026-11-01");
  verifica(nov[0].atti.map((a) => a.id).join() === "10" && nov[1].atti.map((a) => a.id).join() === "11", "novità per argomento");
  const vecchie = await w.novitaPerArgomenti(db, ["imposte di registro"], "2026-11-01");
  verifica(vecchie[0].atti.length === 0, "atti importati prima della data esclusi");
  const { GET } = await import("../app/api/watchlist/novita/route");
  const { NextRequest } = await import("next/server");
  const res = await GET(new NextRequest("http://localhost/api/watchlist/novita?a=volture&a=F%2F3&a=%20&dal=2026-11-01"));
  const j = (await res.json()) as { totale: number; argomenti: unknown[] };
  verifica(res.status === 200 && j.totale === 2 && j.argomenti.length === 2 && /s-maxage/.test(res.headers.get("cache-control") ?? ""), "API novità: 2 atti, argomenti vuoti scartati, cache CDN");

  console.log("\n# Registro anonimo e cron");
  await w.registraArgomento(db, "volture", "segui");
  await w.registraArgomento(db, "Volture", "segui");
  await w.registraArgomento(db, "F/3", "segui");
  await w.registraArgomento(db, "F/3", "smetti");
  const reg = await w.argomentiRegistrati(db);
  verifica(reg.length === 1 && reg[0].seguitoDa === 2, `registro: stessa radice unita, chi smette non conta (${JSON.stringify(reg)})`);

  const { salvaCache, leggiCache, dossierRecenti } = await import("../lib/studio/cache");
  const dossierBase = {
    versione: 1 as const,
    chiave: "voltur",
    argomento: "volture",
    creatoIl: "2026-11-27T10:00:00.000Z",
    versioneCorpus: { documenti: 1, maxId: 9 },
    espansione: [],
    evidenzia: [],
    fonti: [],
    sezioni: [],
    timeline: [],
    lacune: [],
    superate: [],
    verifiche: { citazioniTotali: 0, citazioniValide: 0, citazioniRimosse: 0, riferimentiNonVerificati: [], fontiNonCitate: [] },
    statistiche: { trovate: 1, analizzate: 1, menzioni: 0, perTipo: {}, daAnno: "2005", aAnno: "2005", durataMs: 1, chiamateAi: 0, modello: "x" },
    avvisi: [],
  };
  await salvaCache(db, dossierBase);
  const esito = await w.confrontaNuoviAtti(db, [10, 11]);
  verifica(esito.argomenti.length === 1 && esito.argomenti[0].atti[0].id === 10, "cron: «volture» seguito ha 1 nuovo atto");
  verifica(esito.dossierSegnalati.some((d) => d.argomento === "volture" && d.atti === 1), "cron: dossier «volture» in cache segnalato");
  const letto = await leggiCache(db, "voltur");
  verifica(letto?.nuovaNormativa?.atti === 1, "dossier in cache con badge «nuova normativa»");
  verifica((await dossierRecenti(db))[0].nuovaNormativa === 1, "badge anche nell'elenco dei dossier recenti");
  await salvaCache(db, { ...dossierBase, creatoIl: "2026-12-01T10:00:00.000Z", versioneCorpus: { documenti: 4, maxId: 12 } });
  verifica(!(await leggiCache(db, "voltur"))?.nuovaNormativa, "rigenerato: il badge si azzera");

  console.log(fallimenti === 0 ? "\nTUTTI I CONTROLLI SUPERATI" : `\n${fallimenti} CONTROLLI FALLITI`);
  process.exit(fallimenti === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
