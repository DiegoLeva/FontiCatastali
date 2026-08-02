/**
 * Logica RAG di "Normie": costruzione del contesto normativo, delle fonti
 * autoritative (URL dal DB, MAI dal modello) e del System Prompt.
 */

import type { VectorMatch, ChunkMetadata } from "@/lib/cloudflare";

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

## Citazione delle fonti
- Ogni affermazione basata su una fonte DEVE riportare il riferimento inline nella forma [n] (es. "la variazione va presentata entro 30 giorni [2]"), usando i numeri assegnati alle fonti nel CONTESTO.
- Non inventare numeri di fonte: usa solo quelli presenti nel contesto. I link ai PDF vengono aggiunti automaticamente dal sistema, non scriverli tu.

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

/** Messaggio quando la ricerca vettoriale non trova nulla di pertinente. */
export const NO_CONTEXT_ANSWER =
  "Nella normativa a mia disposizione non trovo documenti pertinenti a questa domanda. Prova a riformularla con termini piu' specifici (es. il tipo di atto, l'istituto catastale o l'anno di riferimento).";
