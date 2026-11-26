/**
 * Prova LOCALE della bonifica dei metadati, su casi presi dal corpus reale.
 *
 *   npx tsx scripts/test-metadati.ts
 *
 * Verifica la normalizzazione (tipologie, numeri, date, anni, titoli
 * inservibili), la prudenza (opere derivate e materiale divulgativo non
 * vengono ridatati) e il runner su libSQL: idempotenza, duplicati esatti,
 * registro delle modifiche, prova a secco senza scritture.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fc-meta-")), "test.db");
process.env.TURSO_DATABASE_URL = `file:${dbFile}`;

let fallimenti = 0;
const verifica = (c: unknown, m: string) => {
  console.log(`  ${c ? "✓" : "✗"} ${m}`);
  if (!c) fallimenti++;
};

const TESTI = {
  circ72011:
    "DI Agenzia del (8) 2 Territorio È CIRCOLARE N. 7/2011 PROT. n°63679 ENTE EMITTENTE: Direzione centrale Catasto e cartografia OGGETTO: Attribuzione della rendita presunta, modalità di gestione dei connessi aggiornamenti negli atti del catasto DESTINATARI: Direzioni centrali, Direzioni regionali, Uffici provinciali DATA DECORRENZA: Data di emanazione Roma, 18 novembre 2011 Franco Maggio 1. Premessa L'art. 19 del decreto legge 31 maggio 2010",
  circ11e:
    "CIRCOLARE N. 11/E Roma, 8 maggio 2023 Allegati: 1 OGGETTO: Modalità di aggiornamento degli archivi catastali nel caso di frazionamento di Enti Urbani. Divisione Servizi",
  dm:
    "MINISTERO DELL'ECONOMIA E DELLE FINANZE DECRETO 27 maggio 2015 Individuazione dei criteri per la designazione, da parte dell'Associazione nazionale dei comuni italiani, dei componenti delle sezioni delle commissioni censuarie locali e centrale. (15A04315) (GU n.127 del 4-6-2015) IL MINISTRO DELL'ECONOMIA E DELLE FINANZE Vista la legge 11 marzo 2014, n. 23",
  dl:
    "DECRETO-LEGGE 6 dicembre 2011, n. 201 Disposizioni urgenti per la crescita, l'equita' e il consolidamento dei conti pubblici. IL PRESIDENTE DELLA REPUBBLICA Visti gli articoli 77 e 87 della Costituzione",
  legge1886:
    "LEGGE 1 marzo 1886, n. 3682 Riordinamento dell'imposta fondiaria. Commento articolo per articolo a cura dell'autore, edizione 2000, con richiami alla giurisprudenza fino al 1999.",
  nota1917:
    "Agenzia del Territorio Direzione Centrale Catasto Prot. n. 12345 Roma, 12 marzo 2017 Ai Direttori degli Uffici provinciali OGGETTO: Aggiornamento delle intestazioni catastali a seguito della legge 2016",
  corso:
    "TABELLA DI CORRISPONDENZA TRA VANI E SUPERFICI MINIME Tabella utilizzata nei corsi di aggiornamento professionale per il calcolo della consistenza catastale dei vani utili.",
};

async function main() {
  const { normalizzaMetadati, dataIso, schemaNome } = await import("../lib/metadati/normalizza");

  console.log("\n# Date e nomi file");
  verifica(dataIso("18 novembre 2011") === "2011-11-18" && dataIso("1° marzo 1886") === "1886-03-01" && dataIso("04/06/2015") === "2015-06-04", "date italiane e numeriche");
  verifica(dataIso("31 febbraio 2011") === null && dataIso("12 marzo 3017") === null, "date impossibili scartate");
  const sn = schemaNome("2011 - Circ. 72011 - Attribuzione della rendita presunta catastale (2).pdf");
  verifica(sn?.anno === 2011 && sn.abbreviazione === "Circ." && sn.numero === "72011", "schema del nome file curato");

  console.log("\n# Normalizzazione");
  const c7 = normalizzaMetadati({ id: 140, cartella: "02 - Circolari", nomeFile: "2011 - Circ. 72011 - Attribuzione della rendita presunta catastale.pdf", titolo: "Circ. 72011 - Attribuzione della rendita presunta catastale", anno: 2011, testo: TESTI.circ72011 });
  verifica(c7.tipoAtto === "Circolare" && c7.numero === "7/2011" && c7.data === "2011-11-18", `circolare 7/2011 del 18/11/2011 (${c7.estremi})`);
  verifica(!c7.anno && !c7.titolo, "nessuna correzione superflua");

  const c11 = normalizzaMetadati({ id: 2489, cartella: "00 - Sito Ade", nomeFile: "Circolare11_2023.pdf", titolo: "Circolare11_2023", anno: 2023, testo: TESTI.circ11e });
  verifica(c11.tipoAtto === "Circolare" && c11.numero === "11/E" && c11.data === "2023-05-08", `nome grezzo "Sito Ade" riconosciuto (${c11.estremi})`);

  const dm = normalizzaMetadati({ id: 1537, cartella: "06 - Decreti Legge", nomeFile: "2015 - DL 27 - Criteri per designazione componenti commissioni censuarie.pdf", titolo: "Decr. 27 - Criteri per designazione componenti commissioni censuarie", anno: 2015, testo: TESTI.dm });
  verifica(dm.tipoAtto === "Decreto ministeriale" && dm.numero === null && dm.data === "2015-05-27", `decreto ministeriale: il "27" del nome è il giorno (${dm.estremi})`);

  const dl = normalizzaMetadati({ id: 9001, cartella: "06 - Decreti Legge", nomeFile: "2012 - DL 201 - Salva Italia.pdf", titolo: "Decr. 201 - Disposizioni urgenti per la crescita", anno: 2012, testo: TESTI.dl });
  verifica(dl.tipoAtto === "Decreto-legge" && dl.numero === "201" && dl.anno?.valore === 2011 && dl.anno.confidenza === "alta", `decreto-legge 201/2011: anno 2012 corretto in 2011 (${dl.anno?.motivo})`);

  const commento = normalizzaMetadati({ id: 934, cartella: "12 - Leggi", nomeFile: "2000 - Legge 3682 - Commento alla legge sul catasto.pdf", titolo: "Legge 3682 - Commento alla legge sul catasto", anno: 2000, testo: TESTI.legge1886 });
  verifica(!commento.anno && commento.revisione.length > 0, "commento del 2000 alla legge del 1886: anno NON cambiato, caso da revisionare");

  const nota = normalizzaMetadati({ id: 9002, cartella: "17 - Note", nomeFile: "1917 - Nota - Aggiornamento intestazioni catastali.pdf", titolo: "Aggiornamento intestazioni catastali", anno: 1917, testo: TESTI.nota1917 });
  verifica(nota.anno?.valore === 2017 && nota.anno.confidenza === "media", `refuso di secolo 1917 → 2017 dalla data di firma (${nota.anno?.motivo})`);

  const slide = normalizzaMetadati({ id: 9003, cartella: "04 - Convegni e slide", nomeFile: "1999 - Slide - Circolare sui fabbricati.pdf", titolo: "Circolare sui fabbricati", anno: 1999, testo: "CIRCOLARE N. 4/T Roma, 12 marzo 2009 OGGETTO: fabbricati" });
  verifica(slide.tipoAtto === "Slide" && !slide.anno, "materiale divulgativo: tipologia e anno non toccati");

  const rotto = normalizzaMetadati({ id: 575, cartella: "05 - Corsi e Indicazioni", nomeFile: "s.d. - Corso - Non è possibile estrarre informazioni utili dal testo fornito.pdf", titolo: "Non è possibile estrarre informazioni utili dal testo fornito", anno: 0, testo: TESTI.corso });
  verifica(!rotto.titolo && rotto.revisione.some((m) => /inservibile/.test(m)), "titolo inservibile senza alternativa affidabile: solo segnalato");

  const mod = normalizzaMetadati({ id: 9004, cartella: "16 - Modulistica", nomeFile: "0000 - Modulistica - Mod Dichiarazione Sostitutiva Certificato Morte.doc - s.n.pdf", titolo: "Mod.", anno: 0, testo: "Il sottoscritto dichiara..." });
  verifica(mod.titolo?.valore === "Modulo Dichiarazione Sostitutiva Certificato Morte" && mod.tipoAtto === "Modulistica", `titolo "Mod." ricostruito dal nome file («${mod.titolo?.valore}»)`);

  const corsoOgg = normalizzaMetadati({ id: 9005, cartella: "05 - Corsi e Indicazioni", nomeFile: "s.d. - Corso - Non c'è testo da elaborare.pdf", titolo: "Non c'è testo da elaborare", anno: 0, testo: "Agenzia del Territorio OGGETTO: Aggiornamento della mappa per la fascia demaniale marittima. Premessa ..." });
  verifica(corsoOgg.titolo?.valore === "Aggiornamento della mappa per la fascia demaniale marittima", `titolo ricavato dall'OGGETTO del testo («${corsoOgg.titolo?.valore}»)`);

  const senzaAnno = normalizzaMetadati({ id: 9006, cartella: "00 - Sito Ade", nomeFile: "Provvedimento_26.01.2021.pdf", titolo: "Provvedimento_26.01.2021", anno: 0, testo: "PROVVEDIMENTO del 26.01.2021 Modalità di consultazione" });
  verifica(senzaAnno.anno?.valore === 2021 && senzaAnno.tipoAtto === "Provvedimento", `anno mancante recuperato dall'intestazione (${senzaAnno.anno?.motivo})`);

  console.log("\n# Runner su database (prova a secco, applicazione, idempotenza)");
  const { createClient } = await import("@libsql/client");
  const db = createClient({ url: `file:${dbFile}` });
  await db.execute(`CREATE TABLE documenti (id INTEGER PRIMARY KEY, cartella_origine TEXT, nuovo_nome_file TEXT, anno INTEGER, titolo TEXT, tema TEXT, testo_estratto TEXT)`);
  await db.executeMultiple(fs.readFileSync(path.join(process.cwd(), "sql", "fts5_setup.sql"), "utf8"));
  const lungo = (t: string) => `${t} ${"Testo di approfondimento sulla disciplina catastale. ".repeat(40)}`;
  const righe: Array<[number, string, string, number, string, string]> = [
    [1, "02 - Circolari", "2011 - Circ. 72011 - Attribuzione della rendita presunta catastale.pdf", 2011, "Circ. 72011 - Attribuzione della rendita presunta catastale", lungo(TESTI.circ72011)],
    [2, "06 - Decreti Legge", "2012 - DL 201 - Salva Italia.pdf", 2012, "Decr. 201 - Disposizioni urgenti per la crescita", lungo(TESTI.dl)],
    [3, "17 - Note", "1917 - Nota - Aggiornamento intestazioni catastali.pdf", 1917, "Aggiornamento intestazioni catastali", lungo(TESTI.nota1917)],
    [4, "02 - Circolari", "2011 - Circ. 72011 - Attribuzione della rendita presunta catastale (2).pdf", 2011, "Circ. 72011 - Attribuzione della rendita presunta catastale", lungo(TESTI.circ72011)],
    [5, "16 - Modulistica", "0000 - Modulistica - Mod Dichiarazione Sostitutiva Certificato Morte.doc - s.n.pdf", 0, "Mod.", "Il sottoscritto dichiara di essere erede."],
  ];
  for (const r of righe) await db.execute({ sql: `INSERT INTO documenti (id, cartella_origine, nuovo_nome_file, anno, titolo, tema, testo_estratto) VALUES (?,?,?,?,?, '', ?)`, args: r });

  const { eseguiBonifica } = await import("../lib/metadati/bonifica");
  const prova = await eseguiBonifica(db, { applica: false });
  const anni1 = (await db.execute(`SELECT anno FROM documenti WHERE id IN (2,3) ORDER BY id`)).rows.map((r) => Number(r.anno));
  const meta0 = Number((await db.execute(`SELECT COUNT(*) AS n FROM documenti_meta`)).rows[0].n);
  verifica(prova.esaminati === 5 && prova.anni === 2 && prova.titoli === 1 && prova.duplicati === 1, `prova a secco: 5 esaminati, 2 anni, 1 titolo, 1 duplicato (${prova.anni}/${prova.titoli}/${prova.duplicati})`);
  verifica(anni1.join(",") === "2012,1917" && meta0 === 0, "prova a secco: nessuna scrittura");

  const appl = await eseguiBonifica(db, { applica: true });
  const doc = (await db.execute(`SELECT id, anno, titolo FROM documenti ORDER BY id`)).rows;
  const meta = (await db.execute(`SELECT doc_id, tipo_atto, numero_atto, data_atto, estremi, duplicato_di FROM documenti_meta ORDER BY doc_id`)).rows;
  verifica(appl.modificati === 3 && Number(doc[1].anno) === 2011 && Number(doc[2].anno) === 2017, "applicata: anni corretti nel corpus");
  verifica(String(doc[4].titolo) === "Modulo Dichiarazione Sostitutiva Certificato Morte", "applicata: titolo inservibile sostituito");
  verifica(meta.length === 5 && meta[0].estremi === "Circolare n. 7/2011 del 18 novembre 2011", `estremi normalizzati in documenti_meta (${meta[0].estremi})`);
  verifica(Number(meta[3].duplicato_di) === 1 && meta[0].duplicato_di === null, "copia «(2)» marcata come duplicato dell'originale");
  const log = (await db.execute(`SELECT campo, prima, dopo FROM metadati_bonifica WHERE applicato = 1 ORDER BY id`)).rows;
  verifica(log.length === 3 && log.some((l) => l.campo === "anno" && l.prima === "2012" && l.dopo === "2011"), "registro delle modifiche con il valore precedente");
  const fts = await db.execute({ sql: `SELECT rowid FROM documenti_fts WHERE documenti_fts MATCH ?`, args: ["sostitutiva"] });
  verifica(fts.rows.length === 1, "indice FTS allineato al nuovo titolo");

  const ancora = await eseguiBonifica(db, { applica: true });
  verifica(ancora.modificati === 0 && ancora.duplicati === 1, "idempotente: seconda esecuzione senza modifiche");

  console.log("\n# Consumatori: duplicati esclusi dalla ricerca");
  const { GET } = await import("../app/api/search/route");
  const { NextRequest } = await import("next/server");
  const res = await GET(new NextRequest("http://localhost/api/search?q=rendita%20presunta"));
  const j = (await res.json()) as { total: number; groups: Array<{ files: Array<{ id: number }> }> };
  const ids = j.groups.flatMap((g) => g.files.map((f) => f.id));
  verifica(ids.includes(1) && !ids.includes(4), `ricerca: la copia esatta non si ripete (${ids.join(",")})`);

  console.log(fallimenti === 0 ? "\nTUTTI I CONTROLLI SUPERATI" : `\n${fallimenti} CONTROLLI FALLITI`);
  process.exit(fallimenti === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
