/**
 * Ponte REST verso l'ecosistema Cloudflare, usato dalle API route su Vercel.
 *
 * Espone 4 primitive, tutte via l'API REST di Cloudflare (nessuna dipendenza da
 * un Worker deployato): embeddings + LLM (Workers AI), ricerca vettoriale
 * (Vectorize v2) e query SQL (D1). Ogni funzione e' isolata e testabile.
 *
 * COSTI: ogni chiamata a Workers AI passa dal budget giornaliero
 * (lib/ai/budget.ts): prenota il costo massimo PRIMA di partire e si salda sui
 * token reali. A budget esaurito la richiesta non viene nemmeno inviata.
 *
 * Env richieste (vedi .env.example):
 *   CF_ACCOUNT_ID       ID account Cloudflare
 *   CF_API_TOKEN        token con permessi: Workers AI (Run), Vectorize, D1 (Read)
 *                       (+ Account Analytics Read: contatore allineato al consumo reale)
 *   CF_VECTORIZE_INDEX  nome dell'indice Vectorize
 *   CF_D1_DATABASE_ID   UUID del database D1
 *   CF_EMBEDDING_MODEL  (opz.) default @cf/baai/bge-m3  (1024 dim, multilingue)
 *   CF_LLM_MODEL        (opz.) default @cf/google/gemma-4-26b-a4b-it
 */

import { BudgetAiEsaurito, neuroni, prenota, salda, stimaToken, type Prenotazione } from "@/lib/ai/budget";

const API_BASE = "https://api.cloudflare.com/client/v4";
// Sotto il maxDuration=60 della route: lascia respirare le risposte lunghe
// senza abortire la fetch prima che il modello finisca.
const REQUEST_TIMEOUT_MS = 55_000;

export const EMBEDDING_MODEL =
  process.env.CF_EMBEDDING_MODEL || "@cf/baai/bge-m3";
/**
 * Modello linguistico predefinito: Gemma 4 26B A4B (MoE, 4B parametri attivi).
 * Costa ~7,5 volte meno in output del Llama 3.3 70B (27.273 contro 204.805
 * neuroni per milione di token) con contesto di 256K: e' cio' che permette di
 * restare nella quota gratuita giornaliera.
 */
export const LLM_MODEL =
  process.env.CF_LLM_MODEL || "@cf/google/gemma-4-26b-a4b-it";
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
 * Quota giornaliera lato Cloudflare (piano Workers Free: errore 4006). Al
 * primo errore di quota le chiamate ai modelli si sospendono per qualche
 * minuto in questa istanza. Sul piano Paid non c'e' errore ma addebito: li'
 * protegge il budget di lib/ai/budget.ts, che blocca PRIMA dell'invio.
 */
const PAUSA_QUOTA_MS = 10 * 60_000;
let quotaSospesaFino = 0;

/** true se in questa istanza Workers AI ha appena segnalato la quota esaurita. */
export function quotaAiEsaurita(): boolean {
  return Date.now() < quotaSospesaFino;
}

/** L'errore indica quota o budget AI esauriti (nessuna chiamata possibile ora). */
export function quotaEsaurita(err: unknown): boolean {
  return err instanceof BudgetAiEsaurito || (err instanceof CloudflareError && err.quotaEsaurita);
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

/* -------------------------------------------------------------------------- */
/* Budget: prenotazione prima dell'invio, saldo sui token reali                */
/* -------------------------------------------------------------------------- */

interface VoceAi {
  modello: string;
  /** Token di input stimati (prudenti). */
  tokenIn: number;
  /** Token di output massimi (max_tokens): la prenotazione copre il caso peggiore. */
  maxOut: number;
}

interface Uso {
  prompt_tokens?: number;
  completion_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
}

function tokenDa(uso: Uso | undefined): { tokenIn: number; tokenOut: number } | null {
  if (!uso) return null;
  const tokenIn = Number(uso.prompt_tokens ?? uso.input_tokens);
  const tokenOut = Number(uso.completion_tokens ?? uso.output_tokens ?? 0);
  return Number.isFinite(tokenIn) && tokenIn > 0 ? { tokenIn, tokenOut: Number.isFinite(tokenOut) ? tokenOut : 0 } : null;
}

async function apriVoce(path: string, voce?: VoceAi): Promise<Prenotazione | null> {
  if (!voce) return null;
  controllaQuota(path);
  return prenota(voce.modello, neuroni(voce.modello, voce.tokenIn, voce.maxOut));
}

/** Errore HTTP: 4xx = rifiutata prima dell'elaborazione (rimborso), altrimenti si tiene. */
async function chiudiVoceConErrore(p: Prenotazione | null, status: number): Promise<void> {
  if (!p) return;
  const rifiutata = status >= 400 && status < 500 && status !== 408;
  await salda(p, rifiutata ? 0 : null, { esito: rifiutata ? `rifiutata ${status}` : `errore ${status}` });
}

const caratteriMessaggi = (messages: ChatMessage[]) => messages.reduce((s, m) => s + m.content.length + 16, 0);

/* -------------------------------------------------------------------------- */
/* Trasporto                                                                   */
/* -------------------------------------------------------------------------- */

interface CfFetchOpts {
  /** Corpo gia' serializzato in NDJSON (upsert Vectorize). */
  ndjson?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Chiamata a Workers AI da mettere a budget. */
  ai?: VoceAi;
  /** Token di output effettivi quando la risposta non riporta `usage`. */
  outStimati?: (result: unknown) => number;
}

function segnale(opts: { timeoutMs?: number; signal?: AbortSignal }): AbortSignal {
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? REQUEST_TIMEOUT_MS);
  return opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout;
}

/** fetch con timeout + budget AI + gestione uniforme degli errori Cloudflare. */
async function cfFetch<T = unknown>(
  path: string,
  body: unknown,
  opts: CfFetchOpts = {}
): Promise<T> {
  const token = requireEnv("CF_API_TOKEN");
  controllaQuota(path);
  const voce = await apriVoce(path, opts.ai);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": opts.ndjson ? "application/x-ndjson" : "application/json",
      },
      body: opts.ndjson ? String(body) : JSON.stringify(body),
      signal: segnale(opts),
      cache: "no-store",
    });
  } catch (err) {
    // Rete, timeout o abbandono: la richiesta potrebbe essere stata elaborata.
    if (voce) await salda(voce, null, { esito: "incerta" });
    throw err;
  }

  const json = (await res.json().catch(() => null)) as
    | { success?: boolean; result?: T; errors?: ErroriCf }
    | null;

  if (!res.ok || !json?.success) {
    await chiudiVoceConErrore(voce, res.status);
    const detail =
      json?.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`;
    throw registra(new CloudflareError(`Cloudflare API error (${path}): ${detail}`, res.status, codiceDi(json?.errors)));
  }
  if (voce && opts.ai) {
    const uso = tokenDa((json.result as { usage?: Uso } | undefined)?.usage);
    const tokenIn = uso?.tokenIn ?? opts.ai.tokenIn;
    const tokenOut = uso?.tokenOut ?? opts.outStimati?.(json.result) ?? opts.ai.maxOut;
    await salda(voce, neuroni(opts.ai.modello, tokenIn, tokenOut), { tokenIn, tokenOut, esito: uso ? "ok" : "ok (stima)" });
  }
  return json.result as T;
}

/**
 * Genera l'embedding di un singolo testo (query utente o chunk).
 * bge-m3 restituisce vettori a 1024 dimensioni: l'indice Vectorize DEVE essere
 * creato con le stesse dimensioni e metrica "cosine".
 */
export async function embed(text: string): Promise<number[]> {
  const [vector] = await embedMany([text]);
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

/** Dimensioni e numero di vettori dell'indice (per il controllo delle quote). */
export async function infoIndice(): Promise<{ dimensioni: number; vettori: number }> {
  const accountId = requireEnv("CF_ACCOUNT_ID");
  const indexName = requireEnv("CF_VECTORIZE_INDEX");
  const token = requireEnv("CF_API_TOKEN");
  const res = await fetch(`${API_BASE}/accounts/${accountId}/vectorize/v2/indexes/${indexName}/info`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as { success?: boolean; result?: { dimensions?: number; vectorCount?: number }; errors?: ErroriCf } | null;
  if (!res.ok || !json?.success) {
    throw new CloudflareError(`Vectorize info: ${json?.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`}`, res.status);
  }
  return { dimensioni: Number(json.result?.dimensions ?? 0), vettori: Number(json.result?.vectorCount ?? 0) };
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
  const tokenIn = texts.reduce((s, t) => s + stimaToken(t.length), 0);
  const result = await cfFetch<{ data?: number[][] }>(
    `/accounts/${accountId}/ai/run/${EMBEDDING_MODEL}`,
    { text: texts },
    { ai: { modello: EMBEDDING_MODEL, tokenIn, maxOut: 0 }, outStimati: () => 0 }
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

/* -------------------------------------------------------------------------- */
/* Modelli linguistici                                                         */
/* -------------------------------------------------------------------------- */

export interface ChatOpts {
  maxTokens?: number;
  temperature?: number;
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Modelli con JSON mode (response_format) garantito da Workers AI. */
const JSON_MODE = new Set([
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/meta/llama-3-8b-instruct",
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
]);

/**
 * Modelli con "ragionamento" interno: i token di pensiero si pagano come
 * output e qui non servono, quindi si disattiva (chat_template_kwargs).
 */
const CON_RAGIONAMENTO = /gemma-4|qwen3|glm-|nemotron/i;

function corpoChat(modello: string, messages: ChatMessage[], maxTokens: number, temperature: number, extra: Record<string, unknown> = {}) {
  return {
    messages,
    max_tokens: maxTokens,
    temperature,
    ...(CON_RAGIONAMENTO.test(modello) ? { chat_template_kwargs: { enable_thinking: false } } : {}),
    ...extra,
  };
}

/** Toglie eventuali blocchi di ragionamento rimasti nel testo. */
const senzaRagionamento = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*?<\/think>/i, "");

/**
 * Testo della risposta. Workers AI risponde nel formato nativo
 * (`response`, stringa o oggetto in JSON mode) oppure in quello OpenAI
 * (`choices[0].message.content`) a seconda del modello.
 */
function testoRisposta(result: unknown): string {
  const r = result as { response?: unknown; choices?: Array<{ message?: { content?: unknown } }> } | null;
  const grezzo = r?.response ?? r?.choices?.[0]?.message?.content;
  if (typeof grezzo === "string") return senzaRagionamento(grezzo).trim();
  if (typeof grezzo === "number") return String(grezzo);
  if (grezzo && typeof grezzo === "object") return JSON.stringify(grezzo);
  return "";
}

const outDaTesto = (result: unknown) => stimaToken(testoRisposta(result).length);

/**
 * Chiamata al modello linguistico (Workers AI). Non-streaming: restituiamo la
 * risposta completa cosi' il backend puo' allegare le fonti autoritative.
 */
export async function chat(
  messages: ChatMessage[],
  opts: ChatOpts = {}
): Promise<string> {
  const accountId = requireEnv("CF_ACCOUNT_ID");
  const modello = opts.model ?? LLM_MODEL;
  const maxTokens = opts.maxTokens ?? 1024;
  const result = await cfFetch<unknown>(
    `/accounts/${accountId}/ai/run/${modello}`,
    // temperatura bassa di default: analisi giuridica, non creativita'
    corpoChat(modello, messages, maxTokens, opts.temperature ?? 0.2),
    {
      timeoutMs: opts.timeoutMs,
      signal: opts.signal,
      ai: { modello, tokenIn: stimaToken(caratteriMessaggi(messages)), maxOut: maxTokens },
      outStimati: outDaTesto,
    }
  );
  const text = testoRisposta(result);
  if (!text) throw new Error("Risposta vuota dal modello.");
  return text;
}

/**
 * Estrae il primo valore JSON (oggetto o array) da un testo: i modelli a
 * volte lo avvolgono in ```json ... ``` o lo fanno precedere da una frase.
 */
export function estraiJson(testo: string): unknown {
  const pulito = senzaRagionamento(testo).replace(/```(?:json)?/gi, "").trim();
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
 * Chat con output JSON. Sui modelli con JSON mode garantito usa
 * `response_format` (output valido per costruzione) e, se rifiutato, ripiega
 * su una richiesta normale; sugli altri chiede il JSON nel prompt e lo estrae
 * dal testo, con UNA sola chiamata. Il chiamante valida comunque i campi.
 */
export async function chatJson(
  messages: ChatMessage[],
  schema: Record<string, unknown>,
  opts: ChatOpts = {}
): Promise<unknown> {
  const accountId = requireEnv("CF_ACCOUNT_ID");
  const modello = opts.model ?? LLM_MODEL;
  const maxTokens = opts.maxTokens ?? 1500;
  const temperature = opts.temperature ?? 0.1;
  if (!JSON_MODE.has(modello)) {
    return estraiJson(await chat(messages, { ...opts, maxTokens, temperature }));
  }
  const path = `/accounts/${accountId}/ai/run/${modello}`;
  try {
    const result = await cfFetch<{ response?: unknown }>(
      path,
      corpoChat(modello, messages, maxTokens, temperature, { response_format: { type: "json_schema", json_schema: schema } }),
      {
        timeoutMs: opts.timeoutMs,
        signal: opts.signal,
        ai: { modello, tokenIn: stimaToken(caratteriMessaggi(messages) + JSON.stringify(schema).length), maxOut: maxTokens },
        outStimati: outDaTesto,
      }
    );
    const r = result?.response;
    if (r && typeof r === "object") return r;
    return estraiJson(testoRisposta(result));
  } catch (err) {
    if (opts.signal?.aborted || quotaEsaurita(err)) throw err;
    // Ripiego solo se il JSON mode e' stato rifiutato (nessun costo sostenuto).
    if (!(err instanceof CloudflareError) || err.status >= 500) throw err;
    return estraiJson(await chat(messages, { ...opts, maxTokens, temperature }));
  }
}

/**
 * Chat in streaming (SSE). Chiama `onToken` per ogni frammento e restituisce
 * il testo completo. Gestisce sia il formato Workers AI (`{"response":"..."}`)
 * sia quello OpenAI (`choices[0].delta.content`); il ragionamento eventuale
 * (`reasoning_content`) viene ignorato. `troncata` e' true se il modello si e'
 * fermato per il limite di token (il chiamante puo' proseguire).
 */
export async function chatStream(
  messages: ChatMessage[],
  onToken: (t: string) => void,
  opts: ChatOpts = {}
): Promise<{ testo: string; troncata: boolean }> {
  const accountId = requireEnv("CF_ACCOUNT_ID");
  const token = requireEnv("CF_API_TOKEN");
  const modello = opts.model ?? LLM_MODEL;
  const maxTokens = opts.maxTokens ?? 1500;
  const path = `/accounts/${accountId}/ai/run/${modello}`;
  const tokenInStimati = stimaToken(caratteriMessaggi(messages));
  const voce = await apriVoce(path, { modello, tokenIn: tokenInStimati, maxOut: maxTokens });
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...corpoChat(modello, messages, maxTokens, opts.temperature ?? 0.2), stream: true }),
      signal: segnale({ timeoutMs: opts.timeoutMs ?? 120_000, signal: opts.signal }),
      cache: "no-store",
    });
  } catch (err) {
    if (voce) await salda(voce, null, { esito: "incerta" });
    throw err;
  }
  if (!res.ok || !res.body) {
    await chiudiVoceConErrore(voce, res.status);
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
  let uso: { tokenIn: number; tokenOut: number } | null = null;
  let tokenUsati = 0;

  const elaboraRiga = (riga: string) => {
    const l = riga.trim();
    if (!l.startsWith("data:")) return;
    const dato = l.slice(5).trim();
    if (!dato || dato === "[DONE]") return;
    try {
      const j = JSON.parse(dato) as {
        response?: string | number;
        choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>;
        usage?: Uso;
        finish_reason?: string;
      };
      // Workers AI restituisce `response` come NUMERO quando il frammento e'
      // fatto di sole cifre (" 1949" -> 1949), perdendo lo spazio iniziale
      // ("marzo1949"): si preferisce delta.content, che resta una stringa.
      const delta = j.choices?.[0]?.delta?.content;
      const pezzo =
        typeof delta === "string" ? delta : j.choices?.length ? "" : typeof j.response === "string" ? j.response : j.response != null ? String(j.response) : "";
      if (pezzo) {
        testo += pezzo;
        onToken(pezzo);
      }
      const fine = j.finish_reason ?? j.choices?.[0]?.finish_reason;
      if (fine === "length") troncata = true;
      const t = tokenDa(j.usage);
      if (t) uso = t;
      if (j.usage?.completion_tokens) tokenUsati = j.usage.completion_tokens;
    } catch {
      /* riga parziale o metadati: ignorata */
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const righe = buffer.split("\n");
      buffer = righe.pop() ?? "";
      for (const r of righe) elaboraRiga(r);
    }
    if (buffer) elaboraRiga(buffer);
  } catch (err) {
    // Stream interrotto: il modello potrebbe aver generato fino al limite.
    if (voce) await salda(voce, null, { esito: "stream interrotto" });
    throw err;
  }

  if (voce) {
    const finale = uso as { tokenIn: number; tokenOut: number } | null;
    const tokenIn = finale?.tokenIn ?? tokenInStimati;
    const tokenOut = finale?.tokenOut ?? stimaToken(testo.length);
    await salda(voce, neuroni(modello, tokenIn, tokenOut), { tokenIn, tokenOut, esito: finale ? "ok" : "ok (stima)" });
  }

  // Workers AI non sempre invia finish_reason: se i token usati toccano il
  // limite, consideriamo la risposta troncata.
  if (!troncata && opts.maxTokens && tokenUsati >= opts.maxTokens - 2) troncata = true;
  return { testo: senzaRagionamento(testo).trim(), troncata };
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
  // il reranker tronca internamente: passiamo un estratto per pesare meno banda
  const contexts = texts.map((t) => ({ text: t.slice(0, 1200) }));
  const tokenIn = contexts.reduce((s, c) => s + stimaToken(query.length + c.text.length), 0);
  const result = await cfFetch<{
    response?: Array<{ id: number; score: number }>;
  }>(
    `/accounts/${accountId}/ai/run/${RERANK_MODEL}`,
    { query, contexts, top_k: topK },
    { ai: { modello: RERANK_MODEL, tokenIn, maxOut: 0 }, outStimati: () => 0 }
  );
  const resp = result?.response ?? [];
  return resp
    .filter((r) => typeof r?.id === "number")
    .slice(0, topK)
    .map((r) => ({ index: r.id, score: r.score }));
}
