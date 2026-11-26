import { chatJson, LLM_MODEL, quotaEsaurita, type ChatMessage } from "@/lib/cloudflare";
import { neuroni, stimaToken } from "@/lib/ai/budget";
import type { Estratti } from "./recupero";
import { inParallelo } from "./recupero";
import type { NotaFonte, RuoloFonte, StatoFonte } from "./tipi";

/**
 * Fase "map" della pipeline: estrazione strutturata, fonte per fonte, di cio'
 * che ciascun documento dice SULL'ARGOMENTO. I lotti sono in parallelo; ogni
 * nota viene validata contro gli estratti: numeri ed estremi che non
 * compaiono nel testo fornito vengono scartati (anti-allucinazione). Nessuna
 * fonte va persa: se il modello la salta si ritenta UNA volta (tutte le
 * saltate del lotto insieme) e, in ultima istanza, si usa una nota
 * deterministica ricavata dall'estratto.
 *
 * Costo: al modello arrivano solo l'inizio del documento e i due passaggi
 * piu' pertinenti, ritagliati attorno alle corrispondenze (~1.100 caratteri
 * per fonte), con istruzioni compatte.
 */

export const MODELLO_ANALISI = process.env.CF_STUDIO_MAP_MODEL || LLM_MODEL;

const RUOLI: RuoloFonte[] = ["istitutivo", "modifica", "chiarimento", "operativo", "abrogazione", "giurisprudenza", "contesto"];
const STATI: StatoFonte[] = ["vigente", "superato", "incerto"];

const SCHEMA = {
  type: "object",
  properties: {
    documenti: {
      type: "array",
      items: {
        type: "object",
        properties: {
          f: { type: "integer" },
          estremi: { type: "string" },
          ruolo: { type: "string", enum: RUOLI },
          stato: { type: "string", enum: STATI },
          sintesi: { type: "string" },
          novita: { type: "string" },
          rinvii: { type: "array", items: { type: "string" } },
        },
        required: ["f", "ruolo", "stato", "sintesi"],
      },
    },
  },
  required: ["documenti"],
};

const SYSTEM = `Giurista esperto di prassi catastale italiana. Analizzi estratti di documenti usando SOLO il testo fornito: niente conoscenze esterne, niente numeri, date o norme inventati. Rispondi solo con JSON valido.`;

export interface FontePerAnalisi {
  n: number;
  titolo: string;
  tipo: string;
  anno: string;
  cartella: string;
  estratti: Estratti;
}

const INCIPIT_MAX = 220;
const PASSAGGIO_MAX = 420;
const PASSAGGI_MAX = 2;

/** Ritaglia un passaggio attorno alla corrispondenza (che cade verso il 40%). */
function ritaglia(p: string, max: number): string {
  if (p.length <= max) return p;
  const centro = Math.floor(p.length * 0.42);
  let da = Math.max(0, Math.min(p.length - max, centro - Math.floor(max * 0.45)));
  let a = da + max;
  const s1 = p.indexOf(" ", da);
  if (da > 0 && s1 >= 0 && s1 - da < 30) da = s1 + 1;
  const s2 = p.lastIndexOf(" ", a);
  if (a < p.length && s2 > da) a = s2;
  return `${da > 0 ? "… " : ""}${p.slice(da, a).replace(/^…\s*/, "").replace(/\s*…$/, "")}${a < p.length ? " …" : ""}`;
}

/** Cio' che il modello vede (e su cui si validano le note). */
export function estrattiCompatti(e: Estratti): Estratti {
  return {
    incipit: e.incipit.slice(0, INCIPIT_MAX),
    passaggi: e.passaggi.slice(0, PASSAGGI_MAX).map((p) => ritaglia(p, PASSAGGIO_MAX)),
    occorrenze: e.occorrenze,
  };
}

function blocco(f: FontePerAnalisi): string {
  const e = estrattiCompatti(f.estratti);
  const passaggi = e.passaggi.length ? e.passaggi.map((p) => `- «${p}»`).join("\n") : "- (nessun passaggio con i termini: valuta l'inizio)";
  return `[F${f.n}] ${f.titolo} | ${f.tipo} | ${f.anno === "0000" ? "s.d." : f.anno}
Inizio: «${e.incipit}»
${passaggi}`;
}

function istruzioni(argomento: string, blocchi: string): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `Argomento: «${argomento}». Per OGNI documento restituisci:
f = numero (12 per [F12]); estremi = tipo, numero e data dell'atto se nel titolo/testo, altrimenti "";
ruolo = istitutivo|modifica|chiarimento|operativo|abrogazione|giurisprudenza|contesto (contesto = cita l'argomento di passaggio);
stato = vigente|superato (solo se il testo lo dice)|incerto;
sintesi = max 35 parole su cosa dice SULL'ARGOMENTO; novita = cosa cambia rispetto a prima, max 25 parole, "" se nulla;
rinvii = max 3 norme citate negli estratti (es. "L. 1249/1939, art. 3"), [] se nessuna.
Solo dati presenti negli estratti. Formato: {"documenti":[{"f":1,"estremi":"","ruolo":"","stato":"","sintesi":"","novita":"","rinvii":[]}]}

${blocchi}`,
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* Validazione                                                                 */
/* -------------------------------------------------------------------------- */

const numeri = (s: string) => s.match(/\d+/g) ?? [];
const breve = (s: unknown, max: number) =>
  String(s ?? "")
    .replace(/\[F\s*\d+[^\]]*\]/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/** I numeri di estremi e rinvii devono comparire negli estratti o nel titolo. */
function supportato(testo: string, evidenza: string): boolean {
  const n = numeri(testo);
  if (n.length === 0) return true;
  return n.every((x) => new RegExp(`(?<!\\d)0*${Number(x)}(?!\\d)`).test(evidenza));
}

function notaValida(grezza: Record<string, unknown>, f: FontePerAnalisi): NotaFonte {
  const visti = estrattiCompatti(f.estratti);
  const evidenza = `${f.titolo} ${visti.incipit} ${visti.passaggi.join(" ")}`;
  const ruolo = RUOLI.includes(grezza.ruolo as RuoloFonte) ? (grezza.ruolo as RuoloFonte) : "contesto";
  const stato = STATI.includes(grezza.stato as StatoFonte) ? (grezza.stato as StatoFonte) : "incerto";
  let estremi = breve(grezza.estremi, 140);
  if (!supportato(estremi, evidenza)) estremi = "";
  const rinvii = (Array.isArray(grezza.rinvii) ? grezza.rinvii : [])
    .map((r) => breve(r, 90))
    .filter((r) => r.length > 2 && supportato(r, evidenza))
    .slice(0, 3);
  return {
    estremi,
    ruolo,
    stato,
    sintesi: breve(grezza.sintesi, 320),
    novita: breve(grezza.novita, 220),
    rinvii,
  };
}

/** Nota di ripiego, senza modello: la prima frase pertinente dell'estratto. */
export function notaAutomatica(f: FontePerAnalisi): NotaFonte {
  const sorgente = f.estratti.passaggi[0] ?? f.estratti.incipit;
  const pulito = sorgente.replace(/^…\s*/, "");
  const frase = (pulito.match(/[^.;:]{40,320}[.;:]/) ?? [pulito.slice(0, 260)])[0].trim();
  return {
    estremi: "",
    ruolo: "contesto",
    stato: "incerto",
    sintesi: frase ? `Dal testo: «${frase}»` : "Nessun estratto testuale disponibile.",
    novita: "",
    rinvii: [],
    automatica: true,
  };
}

/* -------------------------------------------------------------------------- */
/* Lotti                                                                       */
/* -------------------------------------------------------------------------- */

const MAX_CHAR_LOTTO = 9_500;
const MAX_DOC_LOTTO = 8;
const ISTRUZIONI_CARATTERI = 1_150;

export function lotti(fonti: FontePerAnalisi[]): FontePerAnalisi[][] {
  const out: FontePerAnalisi[][] = [];
  let cur: FontePerAnalisi[] = [];
  let len = 0;
  for (const f of fonti) {
    const l = blocco(f).length;
    if (cur.length && (cur.length >= MAX_DOC_LOTTO || len + l > MAX_CHAR_LOTTO)) {
      out.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(f);
    len += l;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Token di output sufficienti per le note di un lotto (~110 per fonte). */
const maxTokenLotto = (n: number) => Math.min(1_800, 140 * n + 120);

/** Caratteri massimi di un blocco dopo la compattazione degli estratti. */
const BLOCCO_MAX = 220 + PASSAGGI_MAX * (PASSAGGIO_MAX + 8) + 240;

/** Stima del caso peggiore (senza margine) per `n` fonti, prima di leggere i testi. */
export function stimaMassimaAnalisi(n: number): number {
  let totale = 0;
  for (let resto = n; resto > 0; resto -= MAX_DOC_LOTTO) {
    const k = Math.min(MAX_DOC_LOTTO, resto);
    totale += neuroni(MODELLO_ANALISI, stimaToken(ISTRUZIONI_CARATTERI + k * BLOCCO_MAX), maxTokenLotto(k));
  }
  return totale;
}

/** Stima prudente (senza margine) dei neuroni della fase di analisi. */
export function stimaNeuroniAnalisi(fonti: FontePerAnalisi[]): number {
  return lotti(fonti).reduce((s, l) => {
    const caratteri = ISTRUZIONI_CARATTERI + l.reduce((c, f) => c + blocco(f).length + 2, 0);
    return s + neuroni(MODELLO_ANALISI, stimaToken(caratteri), maxTokenLotto(l.length));
  }, 0);
}

async function analizzaLotto(argomento: string, lotto: FontePerAnalisi[], signal?: AbortSignal): Promise<Map<number, NotaFonte>> {
  const risposta = (await chatJson(istruzioni(argomento, lotto.map(blocco).join("\n\n")), SCHEMA, {
    model: MODELLO_ANALISI,
    maxTokens: maxTokenLotto(lotto.length),
    temperature: 0.1,
    timeoutMs: 90_000,
    signal,
  })) as { documenti?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
  const voci = Array.isArray(risposta) ? risposta : Array.isArray(risposta?.documenti) ? risposta.documenti : [];
  const perN = new Map(lotto.map((f) => [f.n, f]));
  const out = new Map<number, NotaFonte>();
  for (const v of voci) {
    const n = Number(String(v?.f ?? "").replace(/\D/g, ""));
    const f = perN.get(n);
    if (f && !out.has(n)) out.set(n, notaValida(v, f));
  }
  return out;
}

export interface EsitoAnalisi {
  note: Map<number, NotaFonte>;
  chiamate: number;
  automatiche: number;
  /** Budget AI esaurito durante l'analisi (giornaliero o del dossier). */
  budgetEsaurito: boolean;
}

/**
 * Analizza tutte le fonti (concorrenza limitata). `alLotto` riceve le note man
 * mano che arrivano, per lo streaming progressivo della timeline.
 */
export async function analizzaFonti(
  argomento: string,
  fonti: FontePerAnalisi[],
  alLotto: (note: Array<{ n: number; nota: NotaFonte }>, fatte: number) => void,
  signal?: AbortSignal
): Promise<EsitoAnalisi> {
  const note = new Map<number, NotaFonte>();
  let chiamate = 0;
  let automatiche = 0;
  let fatte = 0;
  let budgetEsaurito = false;
  const gruppi = lotti(fonti);

  await inParallelo(gruppi, 8, async (lotto) => {
    let parziali = new Map<number, NotaFonte>();
    if (!budgetEsaurito && !signal?.aborted) {
      try {
        chiamate++;
        parziali = await analizzaLotto(argomento, lotto, signal);
      } catch (err) {
        if (quotaEsaurita(err)) budgetEsaurito = true;
      }
    }
    // Fonti saltate dal modello: UN tentativo cumulativo, poi la nota automatica.
    const saltate = lotto.filter((x) => !parziali.has(x.n));
    if (saltate.length && !budgetEsaurito && !signal?.aborted) {
      try {
        chiamate++;
        for (const [n, nota] of await analizzaLotto(argomento, saltate, signal)) parziali.set(n, nota);
      } catch (err) {
        if (quotaEsaurita(err)) budgetEsaurito = true;
      }
    }
    for (const f of lotto) {
      if (!parziali.has(f.n)) {
        parziali.set(f.n, notaAutomatica(f));
        automatiche++;
      }
    }
    for (const [n, nota] of parziali) note.set(n, nota);
    fatte += lotto.length;
    alLotto([...parziali.entries()].map(([n, nota]) => ({ n, nota })), fatte);
  });
  return { note, chiamate, automatiche, budgetEsaurito };
}
