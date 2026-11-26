import { chatJson, type ChatMessage } from "@/lib/cloudflare";
import type { Estratti } from "./recupero";
import { inParallelo } from "./recupero";
import type { NotaFonte, RuoloFonte, StatoFonte } from "./tipi";

/**
 * Fase "map" della pipeline: estrazione strutturata, fonte per fonte, di cio'
 * che ciascun documento dice SULL'ARGOMENTO. I lotti sono piccoli (il
 * contesto del modello e' limitato) e in parallelo; ogni nota viene validata
 * contro gli estratti: numeri ed estremi che non compaiono nel testo fornito
 * vengono scartati (anti-allucinazione). Nessuna fonte va persa: se il
 * modello la salta o fallisce, si ritenta da sola e, in ultima istanza, si
 * usa una nota deterministica ricavata dall'estratto.
 */

export const MODELLO_ANALISI = process.env.CF_STUDIO_MAP_MODEL || process.env.CF_LLM_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

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

const SYSTEM = `Sei un giurista esperto di normativa e prassi catastale italiana. Analizzi estratti di documenti per costruire un dossier di studio su un argomento. Usi ESCLUSIVAMENTE il testo fornito: non aggiungi conoscenze esterne, non inventi numeri, date, articoli o norme. Rispondi solo in JSON.`;

export interface FontePerAnalisi {
  n: number;
  titolo: string;
  tipo: string;
  anno: string;
  cartella: string;
  estratti: Estratti;
}

function blocco(f: FontePerAnalisi): string {
  const passaggi = f.estratti.passaggi.length
    ? f.estratti.passaggi.map((p, i) => `${i + 1}. «${p}»`).join("\n")
    : "(nessun passaggio con i termini cercati: valuta l'inizio del documento)";
  return `[F${f.n}] ${f.titolo} | ${f.tipo} | anno ${f.anno === "0000" ? "non indicato" : f.anno} | cartella ${f.cartella}
Inizio del documento: «${f.estratti.incipit}»
Estratti pertinenti:
${passaggi}`;
}

function istruzioni(argomento: string, blocchi: string): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `ARGOMENTO DI STUDIO: «${argomento}»

Per CIASCUN documento elencato restituisci un oggetto con:
- "f": il numero del documento (es. 12 per [F12])
- "estremi": tipo, numero e data dell'atto come risultano dal titolo o dal testo; "" se non ricavabili
- "ruolo": "istitutivo" (introduce l'istituto o la disciplina), "modifica" (modifica o integra norme precedenti), "chiarimento" (interpreta o chiarisce), "operativo" (istruzioni, procedure, software, modelli), "abrogazione" (abroga o supera disposizioni), "giurisprudenza" (sentenze), "contesto" (cita l'argomento solo di passaggio)
- "stato": "vigente", "superato" (solo se il testo lo indica o la disciplina e' dichiarata sostituita) oppure "incerto"
- "sintesi": 1-2 frasi su cosa dice il documento SULL'ARGOMENTO (non in generale)
- "novita": cosa introduce o cambia rispetto alla disciplina precedente, in 1 frase; "" se nulla
- "rinvii": fino a 5 norme citate negli estratti e rilevanti per l'argomento (es. "L. 1249/1939, art. 3"); [] se nessuna

Regole: usa solo gli estratti; se un dato manca lascia la stringa vuota; non inventare.
Formato: {"documenti": [ { "f": ..., ... } ]}

DOCUMENTI:
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
  const evidenza = `${f.titolo} ${f.estratti.incipit} ${f.estratti.passaggi.join(" ")}`;
  const ruolo = RUOLI.includes(grezza.ruolo as RuoloFonte) ? (grezza.ruolo as RuoloFonte) : "contesto";
  const stato = STATI.includes(grezza.stato as StatoFonte) ? (grezza.stato as StatoFonte) : "incerto";
  let estremi = breve(grezza.estremi, 140);
  if (!supportato(estremi, evidenza)) estremi = "";
  const rinvii = (Array.isArray(grezza.rinvii) ? grezza.rinvii : [])
    .map((r) => breve(r, 90))
    .filter((r) => r.length > 2 && supportato(r, evidenza))
    .slice(0, 5);
  return {
    estremi,
    ruolo,
    stato,
    sintesi: breve(grezza.sintesi, 420),
    novita: breve(grezza.novita, 300),
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

const MAX_CHAR_LOTTO = 11_000;
const MAX_DOC_LOTTO = 6;

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

async function analizzaLotto(argomento: string, lotto: FontePerAnalisi[], signal?: AbortSignal): Promise<Map<number, NotaFonte>> {
  const risposta = (await chatJson(istruzioni(argomento, lotto.map(blocco).join("\n\n")), SCHEMA, {
    model: MODELLO_ANALISI,
    maxTokens: 1800,
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
  const gruppi = lotti(fonti);

  await inParallelo(gruppi, 5, async (lotto) => {
    let parziali = new Map<number, NotaFonte>();
    try {
      chiamate++;
      parziali = await analizzaLotto(argomento, lotto, signal);
    } catch (err) {
      if (signal?.aborted) throw err;
    }
    // Fonti saltate dal modello: un tentativo singolo, poi la nota automatica.
    for (const f of lotto.filter((x) => !parziali.has(x.n))) {
      if (signal?.aborted) break;
      try {
        chiamate++;
        const singola = await analizzaLotto(argomento, [f], signal);
        const nota = singola.get(f.n);
        if (nota) parziali.set(f.n, nota);
      } catch {
        /* ripiego sotto */
      }
      if (!parziali.has(f.n)) {
        parziali.set(f.n, notaAutomatica(f));
        automatiche++;
      }
    }
    for (const [n, nota] of parziali) note.set(n, nota);
    fatte += lotto.length;
    alLotto([...parziali.entries()].map(([n, nota]) => ({ n, nota })), fatte);
  });
  return { note, chiamate, automatiche };
}
