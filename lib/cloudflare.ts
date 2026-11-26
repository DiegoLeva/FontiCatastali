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

/** Codice Workers AI: allocazione gratuita giornaliera (10.000 neuroni) esaurita. */
const CODICE_QUOTA = 4006;

/** Errore Cloudflare con lo status HTTP (403 = permesso mancante sul token). */
export class CloudflareError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly codice?: number
  ) {
    super(message);
  }

  get quotaEsaurita(): boolean {
    return this.codice === CODICE_QUOTA || /daily free allocation/i.test(this.message);
  }
}

/*
 * Quota giornaliera di Workers AI. Sul piano Workers Free l'account dispone di
 * 10.000 neuroni al giorno, azzerati alle 00:00 UTC: esauriti quelli, OGNI
 * chiamata ai modelli fallisce con 429/4006. Al primo errore di quota le
 * chiamate ai modelli si sospendono per qualche minuto in questa istanza,
 * cosi' non partono decine di richieste destinate a fallire (un dossier dello
 * Studio ne fa ~30) e l'utente riceve subito un messaggio chiaro. La pausa e'
 * breve di proposito: dopo il passaggio al piano Workers Paid il servizio
 * riprende da solo. Vectorize e D1 non consumano neuroni e restano attivi.
 */
const PAUSA_QUOTA_MS = 10 * 60_000;
let quotaSospesaFino = 0;

/** true se in questa istanza Workers AI ha appena segnalato la quota esaurita. */
export function quotaAiEsaurita(): boolean {
  return Date.now() < quotaSospesaFino;
}

/** L'errore indica la quota giornaliera di Workers AI esaurita. */
export function quotaEsaurita(err: unknown): boolean {
  return err instanceof CloudflareError && err.quotaEsaurita;
}

/** Quando si azzera la quota (00:00 UTC): ora italiana e secondi mancanti. */
export function ripristinoQuota(): { ora: string; secondi: number } {
  const ora = new Date();
  const mezzanotte = Date.UTC(ora.getUTCFullYear(), ora.getUTCMonth(), ora.getUTCDate() + 1);
  return {
    ora: new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit" }).format(mezzanotte),
    secondi: Math.max(60, Math.round((mezzanotte - ora.getTime()) / 1000)),
  };
}

function controllaQuota(path: string): void {
  if (path.includes("/ai/run/") && quotaAiEsaurita()) {
    throw new CloudflareError("Workers AI: quota giornaliera esaurita (chiamate sospese per qualche minuto).", 429, CODICE_QUOTA);
  }
}

function registra(err: CloudflareError): CloudflareError {
  if (err.quotaEsaurita) quotaSospesaFino = Date.now() + PAUSA_QUOTA_MS;
  return err;
}

type ErroriCf = Array<{ message?: string; code?: number }> | undefined;
const codiceDi = (errors: ErroriCf) => errors?.find((e) => typeof e?.code === "number")?.code;

interface CfFetchOpts {
  /** Corpo gia' serializzato in NDJSON (upsert Vectorize). */
  ndjson?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

function segnale(opts: CfFetchOpts): AbortSignal {
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? REQUEST_TIMEOUT_MS);
  return opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout;
}

/** fetch con timeout + gestione uniforme degli errori Cloudflare. */
async function cfFetch<T = unknown>(
  path: string,
  body: unknown,
  opts: CfFetchOpts = {}
): Promise<T> {
  const token = requireEnv("CF_API_TOKEN");
  controllaQuota(path);
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": opts.ndjson ? "application/x-ndjson" : "application/json",
    },
    body: opts.ndjson ? String(body) : JSON.stringify(body),
    signal: segnale(opts),
    cache: "no-store",
  });

  const json = (await res.json().catch(() => null)) as
    | { success?: boolean; result?: T; errors?: ErroriCf }
    | null;

  if (!res.ok || !json?.success) {
    const detail =
      json?.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`;
    throw registra(new CloudflareError(`Cloudflare API error (${path}): ${detail}`, res.status, codiceDi(json?.errors)));
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
 * Ricerca vettoriale "leggera": solo id e punteggio (returnMetadata "none"),
 * che su Vectorize v2 consente topK fino a 100. Gli id dei vettori sono
 * "<docId>-<chunk>", quindi il documento si ricava dall'id stesso.
 */
export async function vectorSearchIds(
  vector: number[],
  topK: number
): Promise<Array<{ id: string; score: number }>> {
  const accountId = requireEnv("CF_ACCOUNT_ID");
  const indexName = requireEnv("CF_VECTORIZE_INDEX");
  const result = await cfFetch<{ matches?: Array<{ id: string; score: number }> }>(
    `/accounts/${accountId}/vectorize/v2/indexes/${indexName}/query`,
    { vector, topK: Math.min(100, topK), returnMetadata: "none", returnValues: false }
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

/** Embedding di piu' testi in una chiamata (bge-m3 accetta un array). */
export async function embedMany(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const accountId = requireEnv("CF_ACCOUNT_ID");
  const result = await cfFetch<{ data?: number[][] }>(
    `/accounts/${accountId}/ai/run/${EMBEDDING_MODEL}`,
    { text: texts }
  );
  const data = result?.data ?? [];
  if (data.length !== texts.length) throw new Error("Numero di embedding inatteso dal modello.");
  return data;
}

export interface VettoreUpsert {
  id: string;
  values: number[];
  metadata?: Record<string, unknown>;
}

/** Upsert su Vectorize v2 (NDJSON). Richiede il permesso Vectorize Edit sul token. */
export async function vectorUpsert(vectors: VettoreUpsert[]): Promise<void> {
  if (vectors.length === 0) return;
  const accountId = requireEnv("CF_ACCOUNT_ID");
  const indexName = requireEnv("CF_VECTORIZE_INDEX");
  await cfFetch(
    `/accounts/${accountId}/vectorize/v2/indexes/${indexName}/upsert`,
    vectors.map((v) => JSON.stringify(v)).join("\n"),
    { ndjson: true, timeoutMs: 60_000 }
  );
}

export interface ChatOpts {
  maxTokens?: number;
  temperature?: number;
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Testo della risposta: in JSON mode Workers AI puo' restituire un oggetto. */
function testoRisposta(response: unknown): string {
  if (typeof response === "string") return response.trim();
  if (typeof response === "number") return String(response);
  if (response && typeof response === "object") return JSON.stringify(response);
  return "";
}

/**
 * Chiamata al modello linguistico (Workers AI). Non-streaming: restituiamo la
 * risposta completa cosi' il backend puo' allegare le fonti autoritative.
 */
export async function chat(
  messages: ChatMessage[],
  opts: ChatOpts = {}
): Promise<string> {
  const accountId = requireEnv("CF_ACCOUNT_ID");
  const result = await cfFetch<{ response?: unknown }>(
    `/accounts/${accountId}/ai/run/${opts.model ?? LLM_MODEL}`,
    {
      messages,
      max_tokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.2, // basso: analisi giuridica, non creativita'
    },
    { timeoutMs: opts.timeoutMs, signal: opts.signal }
  );
  const text = testoRisposta(result?.response);
  if (!text) throw new Error("Risposta vuota dal modello.");
  return text;
}

/**
 * Estrae il primo valore JSON (oggetto o array) da un testo: i modelli a
 * volte lo avvolgono in ```json ... ``` o lo fanno precedere da una frase.
 */
export function estraiJson(testo: string): unknown {
  const pulito = testo.replace(/```(?:json)?/gi, "").trim();
  try {
    return JSON.parse(pulito);
  } catch {
    /* prova a isolare il blocco */
  }
  const inizio = pulito.search(/[[{]/);
  if (inizio < 0) throw new Error("Nessun JSON nella risposta del modello.");
  const apertura = pulito[inizio];
  const chiusura = apertura === "[" ? "]" : "}";
  const fine = pulito.lastIndexOf(chiusura);
  if (fine <= inizio) throw new Error("JSON incompleto nella risposta del modello.");
  const blocco = pulito.slice(inizio, fine + 1).replace(/,\s*([\]}])/g, "$1");
  return JSON.parse(blocco);
}

/**
 * Chat con output JSON. Prima prova il JSON mode nativo di Workers AI
 * (`response_format` con schema: l'output e' JSON valido per costruzione);
 * se il modello o lo schema lo rifiutano, ripiega su una richiesta normale e
 * ne estrae il JSON. Il chiamante valida comunque i campi.
 */
export async function chatJson(
  messages: ChatMessage[],
  schema: Record<string, unknown>,
  opts: ChatOpts = {}
): Promise<unknown> {
  const accountId = requireEnv("CF_ACCOUNT_ID");
  const path = `/accounts/${accountId}/ai/run/${opts.model ?? LLM_MODEL}`;
  const base = {
    messages,
    max_tokens: opts.maxTokens ?? 1500,
    temperature: opts.temperature ?? 0.1,
  };
  try {
    const result = await cfFetch<{ response?: unknown }>(
      path,
      { ...base, response_format: { type: "json_schema", json_schema: schema } },
      { timeoutMs: opts.timeoutMs, signal: opts.signal }
    );
    const r = result?.response;
    if (r && typeof r === "object") return r;
    return estraiJson(testoRisposta(r));
  } catch (err) {
    if (opts.signal?.aborted || quotaEsaurita(err)) throw err;
    const testo = await chat(messages, { ...opts, maxTokens: base.max_tokens, temperature: base.temperature });
    return estraiJson(testo);
  }
}

/**
 * Chat in streaming (SSE). Chiama `onToken` per ogni frammento e restituisce
 * il testo completo. Gestisce sia il formato Workers AI (`{"response":"..."}`)
 * sia quello OpenAI (`choices[0].delta.content`). `troncata` e' true se il
 * modello si e' fermato per il limite di token (il chiamante puo' proseguire).
 */
export async function chatStream(
  messages: ChatMessage[],
  onToken: (t: string) => void,
  opts: ChatOpts = {}
): Promise<{ testo: string; troncata: boolean }> {
  const accountId = requireEnv("CF_ACCOUNT_ID");
  const token = requireEnv("CF_API_TOKEN");
  const path = `/accounts/${accountId}/ai/run/${opts.model ?? LLM_MODEL}`;
  controllaQuota(path);
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      stream: true,
      max_tokens: opts.maxTokens ?? 1500,
      temperature: opts.temperature ?? 0.2,
    }),
    signal: segnale({ timeoutMs: opts.timeoutMs ?? 120_000, signal: opts.signal }),
    cache: "no-store",
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    let codice: number | undefined;
    try {
      codice = codiceDi((JSON.parse(detail) as { errors?: ErroriCf }).errors);
    } catch {
      /* corpo non JSON */
    }
    throw registra(new CloudflareError(`Workers AI stream: HTTP ${res.status} ${detail.slice(0, 200)}`, res.status, codice));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let testo = "";
  let troncata = false;
  let tokenUsati = 0;

  const elaboraRiga = (riga: string) => {
    const l = riga.trim();
    if (!l.startsWith("data:")) return;
    const dato = l.slice(5).trim();
    if (!dato || dato === "[DONE]") return;
    try {
      const j = JSON.parse(dato) as {
        response?: string | number;
        choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
        usage?: { completion_tokens?: number };
        finish_reason?: string;
      };
      // Workers AI restituisce `response` come NUMERO quando il frammento e'
      // fatto di sole cifre (" 1949" -> 1949), perdendo lo spazio iniziale
      // ("marzo1949"): si preferisce delta.content, che resta una stringa.
      const delta = j.choices?.[0]?.delta?.content;
      const pezzo =
        typeof delta === "string" ? delta : typeof j.response === "string" ? j.response : j.response != null ? String(j.response) : "";
      if (pezzo) {
        testo += pezzo;
        onToken(pezzo);
      }
      const fine = j.finish_reason ?? j.choices?.[0]?.finish_reason;
      if (fine === "length") troncata = true;
      if (j.usage?.completion_tokens) tokenUsati = j.usage.completion_tokens;
    } catch {
      /* riga parziale o metadati: ignorata */
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const righe = buffer.split("\n");
    buffer = righe.pop() ?? "";
    for (const r of righe) elaboraRiga(r);
  }
  if (buffer) elaboraRiga(buffer);

  // Workers AI non sempre invia finish_reason: se i token usati toccano il
  // limite, consideriamo la risposta troncata.
  if (!troncata && opts.maxTokens && tokenUsati >= opts.maxTokens - 2) troncata = true;
  return { testo: testo.trim(), troncata };
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
