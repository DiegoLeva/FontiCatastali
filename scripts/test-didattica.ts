/**
 * Prova LOCALE degli strumenti didattici dello Studio (0 neuroni):
 * confronto tra due date, ripasso (flashcard e quiz) ed esportazione Word.
 *
 *   npx tsx scripts/test-didattica.ts
 */
import { inflateRawSync } from "node:zlib";
import type { Dossier, FonteStudio, RuoloFonte, StatoFonte } from "../lib/studio/tipi";

let fallimenti = 0;
const verifica = (c: unknown, m: string) => {
  console.log(`  ${c ? "✓" : "✗"} ${m}`);
  if (!c) fallimenti++;
};

const fonte = (n: number, anno: string, titolo: string, ruolo: RuoloFonte, stato: StatoFonte, sintesi: string, estremi?: string): FonteStudio => ({
  n, id: 100 + n, titolo, anno, cartella: "02 - Circolari", tipo: "Circolare", url: `/documento/${100 + n}`, livello: "analizzata", punteggio: 80,
  concetti: [], inTitolo: true, semantica: false, passaggi: [], estremi,
  nota: { estremi: estremi ?? titolo, ruolo, stato, sintesi, novita: "", rinvii: [] },
});

const dossier: Dossier = {
  versione: 1,
  chiave: "f/3",
  argomento: "Categoria F/3",
  creatoIl: "2026-11-27T08:00:00.000Z",
  versioneCorpus: { documenti: 2187, maxId: 2586 },
  espansione: [],
  evidenzia: [],
  fonti: [
    fonte(1, "1939", "Legge 1249 - Accertamento dei fabbricati urbani", "istitutivo", "superato", "Istituisce il nuovo catasto edilizio urbano e l'obbligo di dichiarazione dei fabbricati.", "Regio decreto-legge n. 652 del 13 aprile 1939"),
    fonte(2, "1949", "Formazione del catasto edilizio urbano", "operativo", "vigente", "Regolamento per la formazione del catasto edilizio urbano: categorie e classamento.", "D.P.R. n. 1142 del 1 dicembre 1949"),
    fonte(3, "1993", "Istituzione del catasto dei fabbricati", "modifica", "vigente", "Istituisce il catasto dei fabbricati e riordina le categorie fittizie."),
    fonte(4, "2001", "Circ. 9 - Procedura Docfa", "operativo", "vigente", "Istruzioni Docfa per le unità in corso di costruzione (categoria F/3).", "Circolare n. 9 del 26 novembre 2001"),
    fonte(5, "2011", "Ris. 3 - Unità in corso di costruzione", "abrogazione", "vigente", "Chiarisce i termini di permanenza in categoria F/3 e supera le indicazioni precedenti."),
    fonte(6, "2016", "Circ. 2 - Unità collabenti e in costruzione", "chiarimento", "vigente", "Chiarimenti sulle categorie fittizie F/2 e F/3 e sui controlli degli uffici."),
  ],
  sezioni: [
    { id: "inquadramento", titolo: "Inquadramento", markdown: "### Che cos'è la categoria F/3\nLe unità **in corso di costruzione** si dichiarano in categoria F/3 [F4].\n- Prima regola: nessuna rendita [F2]\n- Seconda regola: aggiornamento entro i termini [F5, F6]\n1. Primo passo\n2. Secondo passo" },
    { id: "vigente", titolo: "Disciplina vigente", markdown: "La disciplina attuale è nella *circolare* del 2016 [F6]." },
  ],
  timeline: [
    { anno: "1939", n: 1, ruolo: "istitutivo", stato: "superato", cambiamento: "Nasce il nuovo catasto edilizio urbano [F1]." },
    { anno: "1993", n: 3, ruolo: "modifica", stato: "vigente", cambiamento: "Il catasto dei fabbricati riordina le categorie fittizie." },
    { anno: "2001", n: 4, ruolo: "operativo", stato: "vigente", cambiamento: "Docfa disciplina la dichiarazione delle unità in corso di costruzione." },
    { anno: "2011", n: 5, ruolo: "abrogazione", stato: "vigente", cambiamento: "Fissati i termini di permanenza in categoria F/3, superate le indicazioni precedenti." },
    { anno: "2016", n: 6, ruolo: "chiarimento", stato: "vigente", cambiamento: "Chiariti i controlli degli uffici sulle categorie F/2 e F/3." },
  ],
  lacune: [],
  superate: [1],
  verifiche: { citazioniTotali: 6, citazioniValide: 6, citazioniRimosse: 0, riferimentiNonVerificati: [], fontiNonCitate: [] },
  statistiche: { trovate: 182, analizzate: 6, menzioni: 0, perTipo: {}, daAnno: "1939", aAnno: "2016", durataMs: 1, chiamateAi: 0, modello: "x" },
  avvisi: [],
};

/** Legge un file da uno zip (directory centrale + inflate), senza dipendenze. */
function leggiDaZip(zip: Buffer, nome: string): string {
  const fine = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let p = zip.readUInt32LE(fine + 16);
  for (let i = 0, n = zip.readUInt16LE(fine + 10); i < n; i++) {
    const metodo = zip.readUInt16LE(p + 10);
    const compressa = zip.readUInt32LE(p + 20);
    const lNome = zip.readUInt16LE(p + 28);
    const lExtra = zip.readUInt16LE(p + 30);
    const lCommento = zip.readUInt16LE(p + 32);
    const locale = zip.readUInt32LE(p + 42);
    if (zip.toString("utf8", p + 46, p + 46 + lNome) === nome) {
      const dati = locale + 30 + zip.readUInt16LE(locale + 26) + zip.readUInt16LE(locale + 28);
      const grezzi = zip.subarray(dati, dati + compressa);
      return (metodo === 8 ? inflateRawSync(grezzi) : grezzi).toString("utf8");
    }
    p += 46 + lNome + lExtra + lCommento;
  }
  throw new Error(`${nome} non trovato nello zip`);
}

async function main() {
  const did = await import("../lib/studio/didattica");

  console.log("\n# Confronto tra due date");
  verifica(did.anniDossier(dossier).join() === "1939,1949,1993,2001,2011,2016", "anni del dossier in ordine");
  const c = did.confrontaDate(dossier, 1993, 2016);
  verifica(c.giaEmanate.map((v) => v.fonte.n).join() === "3,2,1", `già emanate al 1993, dalla più recente (${c.giaEmanate.map((v) => v.fonte.n).join()})`);
  verifica(c.giaEmanate.find((v) => v.fonte.n === 1)?.superataNellIntervallo === true, "la norma del 1939 oggi superata risulta superata nell'intervallo");
  verifica(c.totaleIntervenute === 3 && c.intervenute.map((g) => g.ruolo).join() === "abrogazione,chiarimento,operativo", `intervenute fino al 2016 per ruolo (${c.intervenute.map((g) => g.ruolo).join()})`);
  verifica(c.cambiamenti.map((v) => v.anno).join() === "2001,2011,2016", "cambiamenti dell'intervallo (estremo iniziale escluso)");
  const inverso = did.confrontaDate(dossier, 2016, 1993);
  verifica(inverso.annoA === 1993 && inverso.annoB === 2016, "date invertite: confronto riordinato");

  console.log("\n# Ripasso");
  const r1 = did.generaRipasso(dossier);
  const r2 = did.generaRipasso(dossier);
  verifica(JSON.stringify(r1) === JSON.stringify(r2), "deterministico: stesso dossier, stesse domande e stesso ordine");
  verifica(r1.flashcard.some((f) => /nel 2011/.test(f.fronte) && /termini di permanenza/.test(f.retro)), "flashcard dalla timeline (anno, atto, cambiamento)");
  verifica(r1.flashcard.some((f) => /D\.P\.R\. n\. 1142/.test(f.fronte) && /classamento/.test(f.retro)), "flashcard dalle sintesi, con gli estremi normalizzati");
  verifica(!r1.flashcard.some((f) => /\[F\d/.test(f.retro)), "niente citazioni grezze [F n] nelle risposte");
  const annoQ = r1.quiz.find((q) => /In che anno/.test(q.domanda));
  verifica(!!annoQ && annoQ.opzioni.length === 4 && new Set(annoQ.opzioni).size === 4, `domanda sull'anno con 4 opzioni distinte (${annoQ?.opzioni.join(" / ")})`);
  verifica(r1.quiz.every((q) => q.corretta >= 0 && q.corretta < q.opzioni.length), "ogni domanda ha la risposta corretta tra le opzioni");
  const antico = r1.quiz.find((q) => /più antico/.test(q.domanda));
  verifica(!antico || /\(\d{4}\)/.test(antico.spiegazione), "domanda sul più antico con gli anni nella spiegazione");

  console.log("\n# Esportazione Word (.docx)");
  const D = await import("docx");
  const { documentoDossier } = await import("../lib/studio/docx");
  const buffer = await D.Packer.toBuffer(documentoDossier(D, dossier, "https://fonti-catastali.vercel.app"));
  verifica(buffer.subarray(0, 2).toString() === "PK" && buffer.length > 5000, `file .docx valido (${buffer.length} byte)`);
  const xml = leggiDaZip(buffer, "word/document.xml");
  const rels = leggiDaZip(buffer, "word/_rels/document.xml.rels");
  const testo = xml.replace(/<[^>]+>/g, "").replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  verifica(testo.includes("Categoria F/3") && testo.includes("STUDIO NORMATIVO"), "copertina con argomento");
  verifica(/w:fldSimple|TOC \\\\o|TOC \\o/.test(xml) || xml.includes("TOC"), "sommario (campo TOC aggiornabile)");
  verifica(testo.includes("Inquadramento") && testo.includes("Che cos'è la categoria F/3") && /<w:b\/>/.test(xml), "capitoli con sottotitoli e grassetti");
  verifica(testo.includes("[F5, F6]") && testo.includes("[F4]"), "citazioni [F n] conservate");
  verifica(testo.includes("Cronologia") && testo.includes("Fissati i termini di permanenza") && xml.includes("<w:tbl>"), "tabella cronologica");
  verifica(testo.includes("Bibliografia") && testo.includes("D.P.R. n. 1142 del 1 dicembre 1949") && rels.includes("https://fonti-catastali.vercel.app/documento/102"), "bibliografia con estremi e link assoluti");
  verifica(!testo.includes("**") && !/\[\s*F\s*\d+\s*,\s*F?\s*\d+\s*\]/.test(testo.replace("[F5, F6]", "")), "nessun markdown residuo");

  console.log(fallimenti === 0 ? "\nTUTTI I CONTROLLI SUPERATI" : `\n${fallimenti} CONTROLLI FALLITI`);
  process.exit(fallimenti === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
