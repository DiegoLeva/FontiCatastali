/**
 * Stima dei neuroni Workers AI di un dossier dello Studio REALE (56 fonti
 * analizzate, come "volture"), con il modello e i parametri attuali. Fallisce
 * se il caso peggiore supera il tetto per dossier: guardia di regressione.
 *
 *   npx tsx scripts/stima-neuroni.ts
 */
process.env.AI_SEED_INSTALLAZIONE = "0";

async function main() {
  const { neuroni, MARGINE, stimaToken } = await import("../lib/ai/budget");
  const { stimaMassimaAnalisi, MODELLO_ANALISI } = await import("../lib/studio/analisi");
  const { pianoSezioni, stimaNeuroniStesura, MODELLO_STESURA } = await import("../lib/studio/stesura");
  const { TETTO_DOSSIER } = await import("../lib/studio/limiti");
  type Fonte = import("../lib/studio/tipi").FonteStudio;

  const N = 56;
  const ruoli = ["istitutivo", "modifica", "chiarimento", "operativo", "contesto"] as const;
  const fonti: Fonte[] = Array.from({ length: N }, (_, i) => ({
    n: i + 1,
    id: i + 1,
    titolo: `Circ. ${i + 1} - Disciplina delle volture catastali e della domanda di voltura telematica, aggiornamento ${1939 + i}`,
    anno: String(1939 + i),
    cartella: "02 - Circolari",
    tipo: "Circolare",
    url: "#",
    livello: "analizzata",
    punteggio: 90 - i,
    concetti: ["volture"],
    inTitolo: true,
    semantica: false,
    passaggi: [],
    nota: {
      estremi: `Circolare n. ${i + 1} del ${1939 + i}`,
      ruolo: ruoli[i % ruoli.length],
      stato: i < 40 ? "superato" : "vigente",
      // Note al limite massimo ammesso dalla validazione (caso peggiore).
      sintesi: "x".repeat(320),
      novita: "x".repeat(220),
      rinvii: ["L. 1249/1939, art. 3", "D.P.R. 650/1972", "Circ. 2/1986"],
    },
  }));

  const piano = pianoSezioni("volture", fonti);
  const analisi = stimaMassimaAnalisi(N) * MARGINE;
  const stesura = stimaNeuroniStesura(piano) * MARGINE;
  const espansione = neuroni(MODELLO_ANALISI, stimaToken(900), 300) * MARGINE;
  const peggiore = analisi + stesura + espansione;
  // Tipico: output reale ~60% dei max_tokens, nessuna ripresa.
  const tipico = peggiore * 0.62;

  const llama = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
  const rapporto = neuroni(llama, 1000, 1000) / neuroni(MODELLO_STESURA, 1000, 1000);

  console.log(`Modelli: analisi ${MODELLO_ANALISI} · stesura ${MODELLO_STESURA}`);
  console.log(`Dossier da ${N} fonti analizzate, ${piano.length} sezioni:`);
  console.log(`  analisi (caso peggiore)  ~${Math.round(analisi)} neuroni`);
  console.log(`  stesura (caso peggiore)  ~${Math.round(stesura)} neuroni`);
  console.log(`  espansione               ~${Math.round(espansione)} neuroni`);
  console.log(`  TOTALE caso peggiore     ~${Math.round(peggiore)} neuroni (+15% incluso)`);
  console.log(`  TOTALE tipico            ~${Math.round(tipico)} neuroni`);
  console.log(`  Con Llama 3.3 70B lo stesso lavoro costerebbe ~${rapporto.toFixed(1)}× di più.`);
  console.log(`Tetto per dossier: ${TETTO_DOSSIER} neuroni.`);
  if (peggiore > TETTO_DOSSIER) {
    console.log("✗ Il caso peggiore supera il tetto per dossier.");
    process.exit(1);
  }
  console.log("✓ Caso peggiore entro il tetto per dossier.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
