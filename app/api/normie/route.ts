import { NextRequest, NextResponse } from "next/server";
import {
  embed,
  vectorSearch,
  d1Query,
  chat,
  type VectorMatch,
  type ChatMessage,
  type VectorizeFilter,
} from "@/lib/cloudflare";
import {
  SYSTEM_PROMPT,
  buildSources,
  buildContext,
  buildUserMessage,
  NO_CONTEXT_ANSWER,
  type NormieResponse,
  type RetrievedChunk,
} from "@/lib/normie";

// Le chiamate REST a Cloudflare + LLM richiedono il runtime Node.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// La generazione LLM (Llama-3.3 70B) puo' essere lunga: 60s per evitare blocchi
// sulle risposte piu' articolate. Richiede piano Vercel Pro (Hobby = max 10s).
export const maxDuration = 60;

const TOP_K = 6; // chunk recuperati da Vectorize
const MIN_SCORE = 0.35; // soglia cosine sotto la quale il match e' rumore
const MAX_QUESTION_LEN = 2000;
const MAX_HISTORY = 4; // ultimi turni inviati al modello per continuita'

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
    ? f.categorie.filter((c) => typeof c === "string" && c.trim().length > 0)
    : [];
  if (cats.length === 1) filter.cartella = { $eq: cats[0] };
  else if (cats.length > 1) filter.cartella = { $in: cats };

  const anno: Record<string, number> = {};
  if (Number.isFinite(f.annoDa)) anno.$gte = Number(f.annoDa);
  if (Number.isFinite(f.annoA)) anno.$lte = Number(f.annoA);
  if (Object.keys(anno).length > 0) filter.anno = anno;

  return Object.keys(filter).length > 0 ? filter : undefined;
}

/**
 * Recupera testo + metadati dei chunk da D1, che e' la fonte AUTORITATIVA per
 * nome file, titolo, cartella e anno (i metadati Vectorize servono solo alla
 * ricerca vettoriale e ai filtri categoria/anno, che non cambiano mai con una
 * rinomina). Cosi' rinominare i file richiede di aggiornare solo D1.
 */
interface ChunkRow {
  id: string;
  doc_id: number;
  titolo: string;
  cartella: string;
  nome_file: string;
  anno: number | string;
  testo: string;
}

async function resolveChunks(
  matches: VectorMatch[]
): Promise<RetrievedChunk[]> {
  if (matches.length === 0) return [];
  const ids = matches.map((m) => m.id);
  const placeholders = ids.map(() => "?").join(",");
  const rows = await d1Query<ChunkRow>(
    `SELECT id, doc_id, titolo, cartella, nome_file, anno, testo
     FROM chunks WHERE id IN (${placeholders})`,
    ids
  );
  const byId = new Map(rows.map((r) => [String(r.id), r]));

  return matches
    .map((m) => {
      const row = byId.get(m.id);
      // D1 autoritativo; fallback ai metadati Vectorize se la riga manca.
      const metadata = row
        ? {
            docId: Number(row.doc_id),
            titolo: String(row.titolo ?? ""),
            cartella: String(row.cartella ?? ""),
            nomeFile: String(row.nome_file ?? ""),
            anno: String(row.anno ?? ""),
          }
        : m.metadata ?? {};
      return {
        metadata,
        testo: row?.testo ?? m.metadata?.testo ?? "",
        score: m.score,
      };
    })
    .filter((c) => c.testo.trim().length > 0);
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
    .slice(-MAX_HISTORY);
}

export async function POST(
  req: NextRequest
): Promise<NextResponse<NormieResponse>> {
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

  try {
    // 1) Embedding della domanda (Cloudflare Workers AI).
    const queryVector = await embed(question);

    // 2) Ricerca dei chunk piu' pertinenti (Cloudflare Vectorize), con
    //    eventuale filtro per categoria/anno sui metadati.
    const filter = buildVectorFilter(body.filters);
    const matches = (await vectorSearch(queryVector, TOP_K, filter)).filter(
      (m) => m.score >= MIN_SCORE
    );

    if (matches.length === 0) {
      return NextResponse.json({ answer: NO_CONTEXT_ANSWER, sources: [] });
    }

    // 3) Testo dei chunk (metadati Vectorize o fallback D1).
    const chunks = await resolveChunks(matches);
    if (chunks.length === 0) {
      return NextResponse.json({ answer: NO_CONTEXT_ANSWER, sources: [] });
    }

    // 4) Fonti autoritative (URL dal DB) + contesto etichettato per [n].
    const { sources, keyToN } = buildSources(chunks);
    const context = buildContext(chunks, keyToN);

    // 5) Generazione della risposta (Cloudflare Workers AI, es. Llama-3).
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...sanitizeHistory(body.history),
      { role: "user", content: buildUserMessage(question, context) },
    ];
    const answer = await chat(messages, { maxTokens: 1024, temperature: 0.2 });

    return NextResponse.json({ answer, sources });
  } catch (err) {
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
