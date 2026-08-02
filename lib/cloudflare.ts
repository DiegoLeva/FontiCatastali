/**
 * Ponte REST verso l'ecosistema Cloudflare, usato dalle API route su Vercel.
 *
 * Espone 4 primitive, tutte via l'API REST di Cloudflare (nessuna dipendenza da
 * un Worker deployato): embeddings + LLM (Workers AI), ricerca vettoriale
 * (Vectorize v2) e query SQL (D1). Ogni funzione e' isolata e testabile.
 *
 * Env richieste (vedi .env.example):
 *   CF_ACCOUNT_ID       ID account Cloudflare
 *   CF_API_TOKEN        token con permessi: Workers AI (Run), Vectorize, D1 (Read)
 *   CF_VECTORIZE_INDEX  nome dell'indice Vectorize
 *   CF_D1_DATABASE_ID   UUID del database D1
 *   CF_EMBEDDING_MODEL  (opz.) default @cf/baai/bge-m3  (1024 dim, multilingue)
 *   CF_LLM_MODEL        (opz.) default @cf/meta/llama-3.3-70b-instruct-fp8-fast
 */

const API_BASE = "https://api.cloudflare.com/client/v4";
// Sotto il maxDuration=60 della route: lascia respirare le risposte lunghe del
// 70B senza abortire la fetch prima che il modello finisca.
const REQUEST_TIMEOUT_MS = 55_000;

export const EMBEDDING_MODEL =
  process.env.CF_EMBEDDING_MODEL || "@cf/baai/bge-m3";
export const LLM_MODEL =
  process.env.CF_LLM_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
// Cross-encoder per il reranking dei chunk recuperati.
export const RERANK_MODEL =
  process.env.CF_RERANK_MODEL || "@cf/baai/bge-reranker-base";

/** Metadati salvati per ogni chunk nell'indice Vectorize. */
export interface ChunkMetadata {
  docId?: number;
  titolo?: string;
  cartella?: string; // cartella_origine
  nomeFile?: string; // nuovo_nome_file
  anno?: string;
  chunkIndex?: number;
  testo?: string; // testo del chunk (se salvato in metadata)
}

export interface VectorMatch {
  id: string;
  score: number;
  metadata: ChunkMetadata;
}

/**
 * Filtro sui metadati Vectorize (query v2). Chiavi = property indicizzate;
 * più chiavi = AND implicito. Operatori: $eq $ne $in $nin $lt $lte $gt $gte.
 * NB: filtrabili SOLO le property con metadata index creato prima dell'ingest.
 */
export type VectorizeFilter = Record<string, unknown>;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variabile d'ambiente mancante: ${name}`);
  return v;
}

/** fetch con timeout + gestione uniforme degli errori Cloudflare. */
async function cfFetch<T = unknown>(
  path: string,
  body: unknown
): Promise<T> {
  const token = requireEnv("CF_API_TOKEN");
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    cache: "no-store",
  });

  const json = (await res.json().catch(() => null)) as
    | { success?: boolean; result?: T; errors?: Array<{ message: string }> }
    | null;

  if (!res.ok || !json?.success) {
    const detail =
      json?.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`;
    throw new Error(`Cloudflare API error (${path}): ${detail}`);
  }
  return json.result as T;
}

/**
 * Genera l'embedding di un singolo testo (query utente o chunk).
 * bge-m3 restituisce vettori a 1024 dimensioni: l'indice Vectorize DEVE essere
 * creato con le stesse dimensioni e metrica "cosine".
 */
export async function embed(text: string): Promise<number[]> {
  const accountId = requireEnv("CF_ACCOUNT_ID");
  const result = await cfFetch<{ data?: number[][]; shape?: number[] }>(
    `/accounts/${accountId}/ai/run/${EMBEDDING_MODEL}`,
    { text: [text] }
  );
  const vector = result?.data?.[0];
  if (!vector?.length) throw new Error("Embedding vuoto dal modello.");
  return vector;
}

/**
 * Ricerca i chunk piu' pertinenti in Vectorize (API v2).
 * returnMetadata:"all" -> riceviamo titolo/cartella/nomeFile/anno per costruire
 * il link al PDF e (se presente) il testo del chunk.
 */
export async function vectorSearch(
  vector: number[],
  topK: number,
  filter?: VectorizeFilter
): Promise<VectorMatch[]> {
  const accountId = requireEnv("CF_ACCOUNT_ID");
  const indexName = requireEnv("CF_VECTORIZE_INDEX");
  const body: Record<string, unknown> = {
    vector,
    topK,
    returnMetadata: "all",
    returnValues: false,
  };
  if (filter && Object.keys(filter).length > 0) body.filter = filter;
  const result = await cfFetch<{ matches?: VectorMatch[] }>(
    `/accounts/${accountId}/vectorize/v2/indexes/${indexName}/query`,
    body
  );
  return result?.matches ?? [];
}

/**
 * Query SQL su D1 (store autoritativo del testo completo dei chunk).
 * Usata quando il testo del chunk NON e' incluso nei metadati Vectorize
 * (metadati Vectorize hanno un limite ~10 KiB per vettore).
 */
export async function d1Query<Row = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<Row[]> {
  const accountId = requireEnv("CF_ACCOUNT_ID");
  const dbId = requireEnv("CF_D1_DATABASE_ID");
  const result = await cfFetch<Array<{ results?: Row[] }>>(
    `/accounts/${accountId}/d1/database/${dbId}/query`,
    { sql, params }
  );
  return result?.[0]?.results ?? [];
}

/**
 * Chiamata al modello linguistico (Workers AI). Non-streaming: restituiamo la
 * risposta completa cosi' il backend puo' allegare le fonti autoritative.
 */
export async function chat(
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number; model?: string } = {}
): Promise<string> {
  const accountId = requireEnv("CF_ACCOUNT_ID");
  const result = await cfFetch<{ response?: string }>(
    `/accounts/${accountId}/ai/run/${opts.model ?? LLM_MODEL}`,
    {
      messages,
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.2, // basso: analisi giuridica, non creativita'
    }
  );
  const text = result?.response?.trim();
  if (!text) throw new Error("Risposta vuota dal modello.");
  return text;
}

/**
 * Rerank dei chunk rispetto alla domanda con un cross-encoder (piu' preciso
 * della sola similarita' vettoriale). Ritorna gli indici (nel medesimo ordine
 * dell'array `texts`) col punteggio, ordinati dal piu' pertinente.
 */
export async function rerank(
  query: string,
  texts: string[],
  topK: number
): Promise<Array<{ index: number; score: number }>> {
  if (texts.length === 0) return [];
  const accountId = requireEnv("CF_ACCOUNT_ID");
  const result = await cfFetch<{
    response?: Array<{ id: number; score: number }>;
  }>(`/accounts/${accountId}/ai/run/${RERANK_MODEL}`, {
    query,
    // il reranker tronca internamente: passiamo un estratto per pesare meno banda
    contexts: texts.map((t) => ({ text: t.slice(0, 1200) })),
    top_k: topK,
  });
  const resp = result?.response ?? [];
  return resp
    .filter((r) => typeof r?.id === "number")
    .slice(0, topK)
    .map((r) => ({ index: r.id, score: r.score }));
}
