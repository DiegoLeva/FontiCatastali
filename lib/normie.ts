/**
 * Logica RAG di "Normie": costruzione del contesto normativo, delle fonti
 * autoritative (URL dal DB, MAI dal modello) e del System Prompt.
 */

import type { ChunkMetadata } from "@/lib/cloudflare";

const DOCS_BASE_URL = process.env.NEXT_PUBLIC_DOCS_BASE_URL || "/docs";

/** Fonte cliccabile mostrata nel frontend (una per documento, deduplicata). */
export interface NormieSource {
  n: number; // numero citazione [1], [2]... usato inline dal modello
  titolo: string;
  anno: string;
  cartella: string;
  nomeFile: string;
  url: string; // link al PDF (autoritativo, costruito dal DB)
}

/** Risposta dell'API /api/normie. */
export interface NormieResponse {
  answer: string;
  sources: NormieSource[];
  error?: string;
}

/** Chunk pronto per il prompt: metadati + testo. */
export interface RetrievedChunk {
  metadata: ChunkMetadata;
  testo: string;
  score: number;
}

function buildPdfUrl(cartella: string, nomeFile: string): string {
  return `${DOCS_BASE_URL}/${encodeURIComponent(cartella)}/${encodeURIComponent(
    nomeFile
  )}`;
}

function formatAnno(anno: unknown): string {
  const n = Number(anno ?? 0);
  return n > 0 ? String(n).padStart(4, "0") : "s.d.";
}

/**
 * Da una lista di chunk recuperati costruisce le fonti deduplicate per
 * documento (cartella + nomeFile) e le numera. Il numero [n] e' la chiave che
 * lega la citazione inline del modello al bottone cliccabile nel frontend.
 * Restituisce anche una mappa docKey -> n per etichettare i chunk nel contesto.
 */
export function buildSources(chunks: RetrievedChunk[]): {
  sources: NormieSource[];
  keyToN: Map<string, number>;
} {
  const sources: NormieSource[] = [];
  const keyToN = new Map<string, number>();

  for (const { metadata } of chunks) {
    const cartella = String(metadata.cartella ?? "");
    const nomeFile = String(metadata.nomeFile ?? "");
    if (!nomeFile) continue;
    const key = `${cartella}|${nomeFile}`;
    if (keyToN.has(key)) continue;

    const n = sources.length + 1;
    keyToN.set(key, n);
    sources.push({
      n,
      titolo: String(metadata.titolo ?? nomeFile),
      anno: formatAnno(metadata.anno),
      cartella,
      nomeFile,
      url: buildPdfUrl(cartella, nomeFile),
    });
  }

  return { sources, keyToN };
}

/**
 * Estrae dai testo della risposta i numeri di fonte effettivamente citati nella
 * forma [n] (gestisce "[3]", "[3] e [5]", "[3], [5]", "[3][5]"). Ignora tutto
 * cio' che non e' un intero positivo. Restituisce un insieme di numeri.
 */
export function extractCitedNumbers(answer: string): Set<number> {
  const cited = new Set<number>();
  const re = /\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer)) !== null) {
    const n = Number(m[1]);
    if (Number.isInteger(n) && n > 0) cited.add(n);
  }
  return cited;
}

/**
 * Allinea le fonti mostrate nel frontend a quelle EFFETTIVAMENTE citate nel
 * testo della risposta: tiene solo le fonti il cui numero [n] compare nella
 * risposta, preservando la numerazione originale (cosi' i riferimenti inline
 * [3], [5]... continuano a puntare al bottone giusto).
 *
 * Fallback prudente: se la risposta non contiene alcuna citazione valida
 * (es. il modello non ha citato nulla, o ha citato solo numeri inesistenti),
 * restituisce l'elenco completo per non nascondere del tutto le fonti.
 */
export function filterCitedSources(
  answer: string,
  sources: NormieSource[]
): NormieSource[] {
  const cited = extractCitedNumbers(answer);
  if (cited.size === 0) return sources;
  const filtered = sources.filter((s) => cited.has(s.n));
  return filtered.length > 0 ? filtered : sources;
}

/**
 * Serializza i chunk in un blocco di contesto etichettato per fonte, cosi' il
 * modello sa a quale [n] appartiene ogni estratto e puo' citarlo con precisione.
 */
export function buildContext(
  chunks: RetrievedChunk[],
  keyToN: Map<string, number>
): string {
  return chunks
    .map(({ metadata, testo }) => {
      const key = `${metadata.cartella ?? ""}|${metadata.nomeFile ?? ""}`;
      const n = keyToN.get(key);
      const intestazione = `[${n}] ${metadata.titolo ?? metadata.nomeFile} (${formatAnno(
        metadata.anno
      )})`;
      return `${intestazione}\n${testo.trim()}`;
    })
    .join("\n\n---\n\n");
}

/**
 * SYSTEM PROMPT di Normie.
 * Vincola il modello a: ragionamento step-by-step, analisi giuridica
 * progressiva, uso ESCLUSIVO del contesto fornito, citazione delle fonti [n].
 */
export const SYSTEM_PROMPT = `Sei "Normie", un assistente giuridico specializzato nella normativa e prassi catastale italiana (circolari, risoluzioni, provvedimenti, decreti, sentenze, guide e istruzioni dell'Agenzia delle Entrate e di altri enti).

## Missione
Aiuti professionisti (geometri, notai, tecnici, funzionari) a risolvere problemi complessi di interpretazione della normativa catastale, ragionando in modo rigoroso e citando sempre le fonti.

## Regole inviolabili sul contesto
1. Rispondi ESCLUSIVAMENTE sulla base degli ESTRATTI NORMATIVI forniti nel blocco CONTESTO. Non usare conoscenze esterne al contesto.
2. Se il contesto NON contiene informazioni sufficienti a rispondere, dichiaralo esplicitamente ("Nella normativa a mia disposizione non trovo elementi sufficienti per rispondere con certezza a questo punto") e, se utile, indica quale documento potrebbe servire. NON inventare mai norme, numeri di circolare, articoli, date o interpretazioni.
3. Non rispondere a domande estranee alla materia catastale/tributaria immobiliare: riporta gentilmente l'utente in tema.

## Metodo di ragionamento (step-by-step, progressivo)
Struttura sempre l'analisi giuridica per passaggi logici, in modo progressivo:
1. **Inquadramento**: identifica l'istituto o il problema giuridico posto dalla domanda.
2. **Base normativa**: individua nel contesto le norme/prassi pertinenti e citale con il loro numero fonte [n].
3. **Analisi**: applica la norma al caso, spiegando il nesso logico passo per passo; evidenzia condizioni, eccezioni, presupposti e termini.
4. **Eventuali contrasti o dubbi**: se le fonti divergono o sono ambigue, segnalalo invece di forzare una conclusione.
5. **Conclusione operativa**: sintetizza la risposta pratica alla domanda.

## Gerarchia e recenza delle fonti
- Ogni fonte nel CONTESTO riporta l'anno tra parentesi. Se piu' fonti trattano lo stesso punto, dai prevalenza alla piu' RECENTE: una circolare/risoluzione/nota successiva puo' superare, aggiornare o derogare la precedente.
- Segnala esplicitamente quando una fonte piu' recente modifica o supera una precedente (es. "aggiornando quanto previsto dalla circolare del 2005 [3]").
- Considera anche la gerarchia normativa (legge/decreto > prassi amministrativa) quando pertinente.

## Citazione delle fonti
- Ogni affermazione basata su una fonte DEVE riportare il riferimento inline nella forma [n] (es. "la variazione va presentata entro 30 giorni [2]"), usando i numeri assegnati alle fonti nel CONTESTO.
- Non inventare numeri di fonte: usa solo quelli presenti nel contesto. I link ai PDF vengono aggiunti automaticamente dal sistema, non scriverli tu.
- Quando ti riferisci a un documento, chiamalo con il TITOLO ESATTO indicato accanto al suo [n] nel CONTESTO. NON coniare nomi alternativi, numeri di circolare/risoluzione/protocollo o date diversi da quelli del titolo: se un dettaglio non e' nel titolo, non attribuirlo al documento.
- Cita SOLO i documenti che usi davvero per la risposta. Non elencare fonti che non contribuiscono ad alcuna affermazione: l'elenco "Fonti" mostrato all'utente conterra' esattamente i [n] che scrivi nel testo.

## Stile
- Italiano professionale, chiaro e conciso. Usa elenchi puntati e grassetto per i punti chiave.
- Tono competente ma accessibile. Niente disclaimer generici ripetuti; una sola, breve nota finale se il caso richiede la verifica di un professionista abilitato.`;

/**
 * Compone il messaggio utente arricchito col contesto normativo.
 */
export function buildUserMessage(question: string, context: string): string {
  return `## CONTESTO (estratti normativi recuperati — usa SOLO questi)
${context}

## DOMANDA
${question}

Rispondi seguendo il metodo step-by-step e cita le fonti con [n].`;
}

/**
 * Espansione della query (C): DETERMINISTICA via glossario catastale.
 * Un LLM piccolo sbaglia gli acronimi di dominio (es. "Docfa" -> "Documento di
 * Cognizione"), quindi usiamo un dizionario curato: corretto, istantaneo, gratis.
 * Le espansioni si sommano alla domanda originale, usata SOLO per l'embedding.
 */
const GLOSSARIO: Array<[RegExp, string]> = [
  // --- sigle / procedure ---
  [/\bdo\.?c\.?fa\b/i, "dichiarazione di variazione Documenti Catasto Fabbricati DOCFA"],
  [/\bpregeo\b/i, "aggiornamento Catasto Terreni tipo mappale frazionamento PREGEO"],
  [/\bnceu\b/i, "Nuovo Catasto Edilizio Urbano"],
  [/\bnct\b/i, "Nuovo Catasto Terreni"],
  [/\btipo\s+mappale\b/i, "tipo mappale TM aggiornamento fabbricati Pregeo"],
  [/\bfrazionament/i, "tipo di frazionamento TF Pregeo Catasto Terreni"],
  [/\bpunt[oi]\s+fiducial|\bpf\b/i, "punto fiduciale PF rete geodetica"],
  // --- categorie fittizie F ---
  [/\bf1\b/i, "area urbana categoria fittizia F1"],
  [/\bf2\b/i, "unità collabente categoria fittizia F2"],
  [/\bf3\b/i, "fabbricato in corso di costruzione categoria fittizia F3"],
  [/\bf4\b/i, "fabbricato in corso di definizione categoria fittizia F4"],
  [/\bf5\b/i, "lastrico solare categoria fittizia F5"],
  [/\bf6\b/i, "fabbricato in attesa di dichiarazione categoria fittizia F6"],
  [/\bcollabent/i, "unità collabente F2 immobile diroccato inagibile"],
  // --- categorie ordinarie/speciali ---
  [/\bcat\.?\s*d\b|categori[ae]\s+d\b/i, "categoria catastale D immobili a destinazione speciale"],
  [/\bcat\.?\s*e\b|categori[ae]\s+e\b/i, "categoria catastale E immobili a destinazione particolare"],
  // --- estimo / valori ---
  [/\bclassament/i, "attribuzione categoria classe rendita catastale classamento"],
  [/\brendit/i, "rendita catastale estimo"],
  [/\bstima\b|valore\s+catastal/i, "stima determinazione valore e rendita catastale"],
  [/\brevisione.*estim|estim.*revision/i, "revisione degli estimi catastali"],
  [/\bomi\b|mercato\s+immobiliar/i, "Osservatorio Mercato Immobiliare OMI valori microzone"],
  [/\bmicrozon/i, "microzone comunali OMI classamento"],
  // --- oggetti catastali ---
  [/\bunit[aà]\s+immobiliar|\buiu\b/i, "unità immobiliare urbana UIU"],
  [/\bparticell|\bmappale\b/i, "particella catastale mappale foglio"],
  [/\bsubaltern|\bsub\b/i, "subalterno identificativo unità immobiliare"],
  [/\bplanimetr/i, "planimetria catastale elaborato planimetrico"],
  [/\bvisur/i, "visura catastale consultazione dati"],
  [/\bunite\s+di\s+fatto|\bporzion/i, "porzioni di unità immobiliari unite di fatto ai fini fiscali"],
  // --- adempimenti / atti ---
  [/\baccatastament|\bcensiment/i, "accatastamento censimento iscrizione in catasto"],
  [/\bvariazione\b/i, "dichiarazione di variazione catastale"],
  [/\bvoltura\b/i, "voltura catastale trasferimento intestazione"],
  [/\bsuccession/i, "dichiarazione di successione voltura catastale"],
  [/\bdonazion/i, "donazione trasferimento immobiliare voltura"],
  [/\busucapion/i, "usucapione acquisto proprietà voltura"],
  [/\brural/i, "fabbricato rurale ruralità requisiti"],
  [/\bagibilit|\babitabilit/i, "agibilità abitabilità requisiti immobile"],
  // --- fiscale / sanzioni ---
  [/\bipotecar/i, "tributi imposte ipotecarie e catastali"],
  [/\bravvediment/i, "ravvedimento operoso sanzioni catastali"],
  [/\bsanzion/i, "sanzioni catastali violazioni"],
  [/\bsuperbonus\b/i, "detrazione fiscale 110% Superbonus"],
  [/\b(agenzia delle entrate|ade)\b/i, "Agenzia delle Entrate"],
];

export function expandQuery(question: string): string {
  const adds: string[] = [];
  for (const [re, exp] of GLOSSARIO) {
    if (re.test(question)) adds.push(exp);
  }
  return adds.length > 0 ? `${question} ${adds.join(" ")}` : question;
}

/** Messaggio quando la ricerca vettoriale non trova nulla di pertinente. */
export const NO_CONTEXT_ANSWER =
  "Nella normativa a mia disposizione non trovo documenti pertinenti a questa domanda. Prova a riformularla con termini piu' specifici (es. il tipo di atto, l'istituto catastale o l'anno di riferimento).";
