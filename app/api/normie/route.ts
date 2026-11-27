import { NextRequest, NextResponse } from "next/server";
import {
  embed,
  vectorSearch,
  rerank,
  chat,
  quotaEsaurita,
  ripristinoQuota,
  type VectorMatch,
  type ChatMessage,
  type VectorizeFilter,
} from "@/lib/cloudflare";
import {
  SYSTEM_PROMPT,
  buildSources,
  buildContext,
  buildUserMessage,
  expandQuery,
  filterCitedSources,
  NO_CONTEXT_ANSWER,
  type NormieResponse,
  type RetrievedChunk,
} from "@/lib/normie";
import { clientIp, NO_STORE } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { getDb } from "@/lib/db";
import { conServizioAi } from "@/lib/ai/budget";
import { prenotaQueryVectorize } from "@/lib/ai/vectorize";
import { recuperoTestuale } from "@/lib/normie-testuale";
import { testiPassaggi } from "@/lib/ai/passaggi";

// Le chiamate REST a Cloudflare + LLM richiedono il runtime Node.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// La generazione LLM puo' essere lunga: 60s per evitare blocchi sulle
// risposte piu' articolate (con Fluid Compute e' ammesso anche su Hobby).
export const maxDuration = 60;

const RETRIEVE_K = 25; // candidati recuperati da Vectorize (poi rerankati)
const MAX_PER_DOC = 3; // passaggi per documento prima del rerank (varieta' di fonti)
const RERANK_K = 8; // chunk finali passati al modello dopo il rerank
const MIN_SCORE = 0.2; // prefiltro cosine largo (EmbeddingGemma): la selezione fine la fa il reranker
// Tetto di output: la prenotazione dei neuroni copre il caso peggiore, quindi
// un tetto piu' basso lascia piu' risposte nella quota gratuita giornaliera.
const MAX_ANSWER_TOKENS = 1500;
const MAX_QUESTION_LEN = 2000;
const MAX_HISTORY = 4; // ultimi turni inviati al modello per continuita'
/** Ogni turno della cronologia viene troncato: il client non e' affidabile. */
const MAX_HISTORY_CHARS = 3000;
/** Rate limit per IP: ogni domanda costa embedding + rerank + LLM. */
const RL_MAX = 12;
const RL_WINDOW_MS = 5 * 60 * 1000;

/** Filtri opzionali scelti dall'utente (categoria + intervallo di anni). */
interface NormieFilters {
  categorie?: string[]; // valori di cartella_origine, es. ["02 - Circolari"]
  annoDa?: number; // anno minimo incluso
  annoA?: number; // anno massimo incluso
}

interface NormieRequestBody {
  message?: string;
  history?: ChatMessage[];
  filters?: NormieFilters;
}

/**
 * Traduce i filtri utente in un filtro-metadati Vectorize.
 * - categoria: $eq (una) oppure $in (più di una) su `cartella`
 * - anni: $gte / $lte su `anno` (numerico)
 * Property multiple = AND implicito. Restituisce undefined se nessun filtro.
 * NB: richiede i metadata index su `cartella` (string) e `anno` (number).
 */
function buildVectorFilter(f?: NormieFilters): VectorizeFilter | undefined {
  if (!f) return undefined;
  const filter: Record<string, unknown> = {};

  const cats = Array.isArray(f.categorie)
    ? f.categorie
        .filter((c) => typeof c === "string" && c.trim().length > 0)
        .map((c) => c.trim().slice(0, 120))
        .slice(0, 12)
    : [];
  if (cats.length === 1) filter.cartella = { $eq: cats[0] };
  else if (cats.length > 1) filter.cartella = { $in: cats };

  // Anni plausibili soltanto: un valore assurdo non deve arrivare a Vectorize.
  const annoOk = (v: unknown) =>
    Number.isFinite(v) && Number(v) >= 1800 && Number(v) <= 2100;
  const anno: Record<string, number> = {};
  if (annoOk(f.annoDa)) anno.$gte = Number(f.annoDa);
  if (annoOk(f.annoA)) anno.$lte = Number(f.annoA);
  if (Object.keys(anno).length > 0) filter.anno = anno;

  return Object.keys(filter).length > 0 ? filter : undefined;
}

/**
 * Testo e metadati dei passaggi trovati da Vectorize: da Turso (tabella
 * `passaggi` + documenti), fonte autoritativa per titolo, cartella, nome file
 * e anno anche dopo rinomine o bonifiche dei metadati.
 */
async function resolveChunks(
  matches: VectorMatch[]
): Promise<RetrievedChunk[]> {
  if (matches.length === 0) return [];
  const testi = await testiPassaggi(getDb(), matches.map((m) => m.id));
  return matches
    .map((m): RetrievedChunk | null => {
      const t = testi.get(m.id);
      if (!t || !t.testo) return null;
      return {
        metadata: { docId: t.docId, titolo: t.titolo, cartella: t.cartella, nomeFile: t.nomeFile, anno: t.anno },
        testo: t.testo,
        score: m.score,
      };
    })
    .filter((c): c is RetrievedChunk => c !== null);
}

/** Semantici + testuali senza doppioni, al massimo MAX_PER_DOC per documento. */
function unisciCandidati(...gruppi: RetrievedChunk[][]): RetrievedChunk[] {
  const visti = new Set<string>();
  const perDoc = new Map<string, number>();
  const out: RetrievedChunk[] = [];
  for (const c of gruppi.flat()) {
    const doc = String(c.metadata.docId ?? c.metadata.nomeFile ?? "");
    const chiave = `${doc}|${c.testo.replace(/\s+/g, " ").slice(0, 120)}`;
    if (visti.has(chiave) || (perDoc.get(doc) ?? 0) >= MAX_PER_DOC) continue;
    visti.add(chiave);
    perDoc.set(doc, (perDoc.get(doc) ?? 0) + 1);
    out.push(c);
  }
  return out;
}

function sanitizeHistory(history: unknown): ChatMessage[] {
  if (!Array.isArray(history)) return [];
  return history
    .filter(
      (m): m is ChatMessage =>
        !!m &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string"
    )
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_HISTORY_CHARS) }));
}

export async function POST(
  req: NextRequest
): Promise<NextResponse<NormieResponse>> {
  const rl = rateLimit(`normie:${clientIp(req)}`, RL_MAX, RL_WINDOW_MS);
  if (!rl.ok) {
    return NextResponse.json(
      {
        answer: "",
        sources: [],
        error: `Hai fatto molte domande in poco tempo. Riprova tra ${rl.retryAfter} secondi.`,
      },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfter), "Cache-Control": NO_STORE },
      }
    );
  }

  let body: NormieRequestBody;
  try {
    body = (await req.json()) as NormieRequestBody;
  } catch {
    return NextResponse.json(
      { answer: "", sources: [], error: "Richiesta non valida." },
      { status: 400 }
    );
  }

  const question = (body.message ?? "").trim().slice(0, MAX_QUESTION_LEN);
  if (!question) {
    return NextResponse.json(
      { answer: "", sources: [], error: "Domanda vuota." },
      { status: 400 }
    );
  }

  return conServizioAi("normie", () => rispondi(question, body));
}

async function rispondi(question: string, body: NormieRequestBody): Promise<NextResponse<NormieResponse>> {
  try {
    // 1-3) Recupero ibrido. Testuale sempre (FTS di Turso + estratti dei testi
    //      integrali: imbattibile su codici ed estremi come F/3 o Circ. 2/2016);
    //      semantico (Vectorize) solo se resta entro le quote incluse nel piano
    //      e l'indice e' completo. Il reranker sceglie tra i due canali.
    const [semantici, testuali] = await Promise.all([
      (async (): Promise<RetrievedChunk[]> => {
        if (!(await prenotaQueryVectorize())) return [];
        try {
          // Espansione della query: scioglie sigle + sinonimi (solo per l'embedding).
          const queryVector = await embed(expandQuery(question));
          const filter = buildVectorFilter(body.filters);
          const matches = (await vectorSearch(queryVector, RETRIEVE_K, filter)).filter((m) => m.score >= MIN_SCORE);
          return await resolveChunks(matches);
        } catch (err) {
          if (quotaEsaurita(err)) throw err;
          console.warn("[/api/normie] canale semantico non disponibile:", (err as Error).message);
          return [];
        }
      })(),
      recuperoTestuale(getDb(), question, body.filters),
    ]);
    let chunks = unisciCandidati(semantici, testuali);
    if (chunks.length === 0) {
      return NextResponse.json({ answer: NO_CONTEXT_ANSWER, sources: [] });
    }

    // 4) Rerank (A): cross-encoder sulla DOMANDA ORIGINALE -> i piu' pertinenti.
    //    Fallback all'ordine vettoriale se il reranker non risponde.
    try {
      const ranked = await rerank(
        question,
        chunks.map((c) => c.testo),
        RERANK_K
      );
      chunks =
        ranked.length > 0
          ? ranked
              .map((r) => chunks[r.index])
              .filter((c): c is RetrievedChunk => Boolean(c))
          : chunks.slice(0, RERANK_K);
    } catch {
      chunks = chunks.slice(0, RERANK_K);
    }

    // 5) Fonti autoritative (URL dal DB) + contesto etichettato per [n] (con anno).
    const { sources, keyToN } = buildSources(chunks);
    const context = buildContext(chunks, keyToN);

    // 6) Generazione della risposta (Cloudflare Workers AI, Llama-3.3 70B).
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...sanitizeHistory(body.history),
      { role: "user", content: buildUserMessage(question, context) },
    ];
    const answer = await chat(messages, {
      maxTokens: MAX_ANSWER_TOKENS,
      temperature: 0.2,
    });

    // 7) Mostra all'utente SOLO le fonti effettivamente citate [n] nella
    //    risposta, così l'elenco "Fonti" combacia con i riferimenti inline
    //    (le fonti recuperate ma non citate non vengono elencate).
    const citedSources = filterCitedSources(answer, sources);

    return NextResponse.json({ answer, sources: citedSources });
  } catch (err) {
    if (quotaEsaurita(err)) {
      // Quota giornaliera di Workers AI esaurita: messaggio chiaro, niente 500.
      const { ora, secondi } = ripristinoQuota();
      console.warn("[/api/normie] quota giornaliera di Workers AI esaurita");
      return NextResponse.json(
        {
          answer: "",
          sources: [],
          error: `Normie è in pausa: la quota giornaliera del servizio AI è esaurita e si azzera alle ${ora} (ora italiana). Nel frattempo puoi usare la ricerca testuale e i dossier già pronti dello Studio Normativo.`,
        },
        { status: 503, headers: { "Retry-After": String(secondi), "Cache-Control": NO_STORE } }
      );
    }
    console.error("[/api/normie] errore:", err);
    return NextResponse.json(
      {
        answer: "",
        sources: [],
        error:
          "Si e' verificato un errore nell'elaborazione. Riprova tra qualche istante.",
      },
      { status: 500 }
    );
  }
}
