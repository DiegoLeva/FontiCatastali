import { chatStream, type ChatMessage } from "@/lib/cloudflare";
import type { FonteStudio, NotaFonte } from "./tipi";

/**
 * Fase "reduce": stesura del dossier per SEZIONI.
 *
 * Anti-troncamento: nessuna risposta unica e lunghissima (il limite di token
 * la taglierebbe). Ogni capitolo e' una chiamata separata con il suo contesto
 * mirato; l'evoluzione cronologica e' divisa per periodi (al massimo 12 fonti
 * ciascuno) e ogni periodo DEVE citare tutte le sue fonti; se il modello si
 * ferma per il limite, la stesura riprende da dove si e' interrotta.
 */

export const MODELLO_STESURA = process.env.CF_STUDIO_WRITE_MODEL || process.env.CF_LLM_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const SYSTEM = `Sei un docente di diritto catastale che scrive un manuale di studio per professionisti (geometri, ingegneri, notai, funzionari). Italiano rigoroso, chiaro, scorrevole.

REGOLE INVIOLABILI
1. Usa ESCLUSIVAMENTE le SCHEDE DELLE FONTI fornite. Nessuna conoscenza esterna.
2. Ogni affermazione normativa porta la citazione della scheda da cui deriva, nella forma [F12] (piu' fonti: [F3, F12]).
3. Non scrivere numeri di leggi, articoli, circolari, date o importi che non compaiono nelle schede. Non attribuire a una fonte cio' che la sua scheda non dice.
4. Se un passaggio storico o un dato manca nelle schede, dichiaralo esplicitamente (es. "Nel database non risultano fonti che documentino ...").
5. Niente titoli di primo o secondo livello (#, ##): il titolo della sezione lo aggiunge il sistema. Puoi usare paragrafi, elenchi puntati e grassetto.
6. Niente premesse ("In questa sezione...") ne' conclusioni di rito.`;

export interface SezionePiano {
  id: string;
  titolo: string;
  /** Sottotitolo di periodo per le parti dell'evoluzione ("1939 – 1985"). */
  sottotitolo?: string;
  messaggi: ChatMessage[];
  maxTokens: number;
}

/** Scheda compatta di una fonte per il modello. */
export function scheda(f: FonteStudio): string {
  const n = f.nota as NotaFonte;
  const anno = f.anno === "0000" ? "s.d." : f.anno;
  const righe = [
    `[F${f.n}] ${anno} · ${f.tipo} · «${f.titolo}»${n?.estremi ? ` · estremi: ${n.estremi}` : ""} · ruolo: ${n?.ruolo ?? "contesto"} · stato: ${n?.stato ?? "incerto"}`,
    `  sintesi: ${n?.sintesi || "—"}`,
  ];
  if (f.annoDubbio) {
    righe.push(`  ATTENZIONE: l'anno ${anno} del database e' probabilmente errato (il testo cita il ${f.annoDubbio}): non usarla per datare l'evoluzione, segnala l'incongruenza se la citi.`);
  }
  if (n?.novita) righe.push(`  novità: ${n.novita}`);
  if (n?.rinvii?.length) righe.push(`  rinvii: ${n.rinvii.join("; ")}`);
  return righe.join("\n");
}

const intervallo = (fonti: FonteStudio[]) => {
  const anni = fonti.map((f) => f.anno).filter((a) => a !== "0000");
  if (!anni.length) return "senza data";
  const da = anni[0];
  const a = anni[anni.length - 1];
  return da === a ? da : `${da} – ${a}`;
};

function messaggi(argomento: string, compito: string, schede: string): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: `ARGOMENTO DEL DOSSIER: «${argomento}»\n\nCOMPITO\n${compito}\n\nSCHEDE DELLE FONTI (ordine cronologico)\n${schede}` },
  ];
}

/**
 * Piano delle sezioni. `analizzate` e' gia' in ordine cronologico (n crescente)
 * e ogni fonte ha la sua nota.
 */
export function pianoSezioni(argomento: string, analizzate: FonteStudio[]): SezionePiano[] {
  const perRilevanza = [...analizzate].sort((a, b) => b.punteggio - a.punteggio);
  const datate = analizzate.filter((f) => f.anno !== "0000");
  const recenti = [...datate].reverse();
  const unici = (lista: FonteStudio[], max: number) => {
    const visti = new Set<number>();
    return lista.filter((f) => !visti.has(f.n) && visti.add(f.n)).slice(0, max).sort((a, b) => a.n - b.n);
  };

  const piano: SezionePiano[] = [];

  // 1) Cos'e' e inquadramento.
  const inquadramento = unici([...perRilevanza.slice(0, 10), ...recenti.slice(0, 4)], 14);
  piano.push({
    id: "inquadramento",
    titolo: "Cos'è e inquadramento",
    maxTokens: 1100,
    messaggi: messaggi(
      argomento,
      `Scrivi la sezione "Cos'è e inquadramento": definisci l'istituto o il tema, il suo ambito di applicazione ATTUALE e i soggetti/atti coinvolti, in 2-4 paragrafi. Dai prevalenza alle fonti piu' recenti per descrivere la situazione attuale. Cita ogni affermazione.`,
      inquadramento.map(scheda).join("\n")
    ),
  });

  // 2) Origini e finalita' originaria.
  const istitutive = analizzate.filter((f) => f.nota?.ruolo === "istitutivo");
  const origini = unici([...datate.slice(0, 8), ...istitutive.slice(0, 4)], 12);
  if (origini.length) {
    piano.push({
      id: "origini",
      titolo: "Origini e finalità originaria",
      maxTokens: 1000,
      messaggi: messaggi(
        argomento,
        `Scrivi la sezione "Origini e finalità originaria": da quale norma o atto risulta introdotto l'istituto nelle fonti disponibili e a cosa serviva in origine. Se la fonte piu' antica del database richiama una norma istitutiva che NON e' tra le schede, dillo esplicitamente ("la norma istitutiva, richiamata da [Fn], non e' presente nel database"). 1-3 paragrafi.`,
        origini.map(scheda).join("\n")
      ),
    });
  }

  // 3) Evoluzione cronologica, per periodi.
  const PER_PARTE = 12;
  const parti: FonteStudio[][] = [];
  for (let i = 0; i < analizzate.length; i += PER_PARTE) parti.push(analizzate.slice(i, i + PER_PARTE));
  parti.forEach((parte, i) => {
    const precedente = i > 0 ? parti[i - 1][parti[i - 1].length - 1] : null;
    const continuita = precedente
      ? `\nPer continuita', il periodo precedente si chiudeva con [F${precedente.n}] (${precedente.anno}): «${precedente.nota?.sintesi ?? ""}». NON ripeterlo, prosegui da li'.`
      : "";
    piano.push({
      id: `evoluzione-${i + 1}`,
      titolo: "Evoluzione cronologica",
      sottotitolo: intervallo(parte),
      maxTokens: 1700,
      messaggi: messaggi(
        argomento,
        `Scrivi la parte ${i + 1} di ${parti.length} della sezione "Evoluzione cronologica" (periodo ${intervallo(parte)}).
Ricostruisci passo per passo come la disciplina si e' evoluta in questo periodo, collegando ogni atto al precedente con connettivi temporali ("Originariamente…", "Con la circolare… [Fn] si precisa…", "Successivamente…", "Da ultimo…").
OBBLIGATORIO: menziona e cita TUTTE le ${parte.length} fonti delle schede, nell'ordine cronologico, spiegando per ciascuna che cosa introduce, modifica o chiarisce. Per le fonti con ruolo "contesto" basta una frase. Segnala quando una fonte supera o modifica una precedente.${continuita}`,
        parte.map(scheda).join("\n")
      ),
    });
  });

  // 4) Disciplina vigente e punti operativi.
  const vigenti = unici(
    [...recenti.filter((f) => f.nota?.stato !== "superato").slice(0, 12), ...analizzate.filter((f) => f.nota?.ruolo === "operativo" || f.nota?.ruolo === "chiarimento").slice(-6)],
    16
  );
  const superate = analizzate.filter((f) => f.nota?.stato === "superato").slice(-6);
  piano.push({
    id: "vigente",
    titolo: "Disciplina vigente e punti chiave operativi",
    maxTokens: 1500,
    messaggi: messaggi(
      argomento,
      `Scrivi la sezione "Disciplina vigente e punti chiave operativi":
- un paragrafo su cosa si applica OGGI secondo le fonti piu' recenti;
- un elenco puntato di punti operativi (adempimenti, termini, condizioni, eccezioni, chiarimenti ricorrenti), ciascuno con citazione;
- distingui in modo netto le regole vigenti da quelle superate o abrogate (indicale come tali).
Se le schede non bastano a stabilire la disciplina vigente su un punto, dichiaralo.`,
      [...vigenti, ...superate.filter((s) => !vigenti.some((v) => v.n === s.n))].sort((a, b) => a.n - b.n).map(scheda).join("\n")
    ),
  });

  return piano;
}

/**
 * Esegue una sezione in streaming con ripresa automatica in caso di
 * troncamento (fino a 2 riprese).
 */
export async function scriviSezione(
  s: SezionePiano,
  onToken: (t: string) => void,
  signal?: AbortSignal
): Promise<{ testo: string; chiamate: number }> {
  let testo = "";
  let chiamate = 0;
  let msgs = s.messaggi;
  for (let tentativo = 0; tentativo < 3; tentativo++) {
    chiamate++;
    const r = await chatStream(msgs, onToken, {
      model: MODELLO_STESURA,
      maxTokens: s.maxTokens,
      temperature: 0.2,
      timeoutMs: 150_000,
      signal,
    });
    testo += (testo && !/\s$/.test(testo) && !/^\s/.test(r.testo) ? " " : "") + r.testo;
    if (!r.troncata) break;
    msgs = [
      ...s.messaggi,
      { role: "assistant", content: testo },
      { role: "user", content: "Continua esattamente da dove ti sei interrotto, senza ripetere nulla e senza introduzioni." },
    ];
  }
  return { testo: testo.trim(), chiamate };
}

/* -------------------------------------------------------------------------- */
/* Verifiche anti-allucinazione                                                */
/* -------------------------------------------------------------------------- */

const RE_CITAZIONE = /\[\s*F\s*\d+(?:\s*[,;]\s*(?:F\s*)?\d+)*\s*\]/gi;

/**
 * Tiene solo le citazioni a fonti realmente analizzate; normalizza la forma
 * ("[F3, F7]"). Restituisce il testo pulito e i conteggi.
 */
export function validaCitazioni(md: string, valide: Set<number>): { md: string; totali: number; valide: number; rimosse: number; citate: Set<number> } {
  let totali = 0;
  let ok = 0;
  let rimosse = 0;
  const citate = new Set<number>();
  const out = md.replace(RE_CITAZIONE, (gruppo) => {
    const nums = (gruppo.match(/\d+/g) ?? []).map(Number);
    totali += nums.length;
    const buoni = [...new Set(nums.filter((n) => valide.has(n)))];
    ok += buoni.length;
    rimosse += nums.length - buoni.length;
    buoni.forEach((n) => citate.add(n));
    return buoni.length ? `[${buoni.map((n) => `F${n}`).join(", ")}]` : "";
  });
  return { md: out.replace(/ +([.,;:])/g, "$1").replace(/[ \t]{2,}/g, " "), totali, valide: ok, rimosse, citate };
}

const RE_RIFERIMENTO =
  /\b(?:legge|l\.|d\.\s?l(?:gs)?\.|d\.\s?lgs\.?|decreto(?:[\s-]legge| legislativo| ministeriale| del presidente della repubblica)?|d\.\s?p\.\s?r\.|r\.\s?d(?:\.\s?l)?\.|d\.\s?m\.|circolare|risoluzione|provvedimento|nota)\s*(?:n\.?\s*|n°\s*)?(\d{1,6})(?:\s*\/\s*[a-z]{1,2})?(?:\s*(?:\/|del(?:l')?\s*(?:\d{1,2}\s*(?:[a-z]+|\/\s*\d{1,2})\s*\/?\s*)?)\s*(\d{4}))?/gi;

/**
 * Riferimenti normativi presenti nel testo generato ma non negli estratti o
 * nei titoli forniti al modello: possibili allucinazioni da segnalare.
 */
export function riferimentiNonVerificati(md: string, evidenza: string): string[] {
  const ev = evidenza.toLowerCase();
  const contiene = (num: string) => new RegExp(`(?<!\\d)0*${Number(num)}(?!\\d)`).test(ev);
  const out = new Set<string>();
  for (const m of md.matchAll(RE_RIFERIMENTO)) {
    const [testo, num, anno] = m;
    if (!num || Number(num) < 2) continue;
    if (!contiene(num) || (anno && !contiene(anno))) out.add(testo.trim());
  }
  return [...out].slice(0, 20);
}

/* -------------------------------------------------------------------------- */
/* Lacune e superate (deterministiche)                                         */
/* -------------------------------------------------------------------------- */

function chiaveRinvio(r: string): string | null {
  const m = r.toLowerCase().match(/(\d{1,6})\s*(?:\/|del\s+(?:\d{1,2}\s+[a-z]+\s+)?)\s*(\d{4})/);
  return m ? `${Number(m[1])}/${m[2]}` : null;
}

/**
 * Norme richiamate dalle fonti ma assenti dal database: per ogni rinvio con
 * numero e anno si cerca un documento del corpus con quel numero e quell'anno.
 */
export function calcolaLacune(analizzate: FonteStudio[], tutte: FonteStudio[]): Array<{ riferimento: string; citatoDa: number[] }> {
  const perChiave = new Map<string, { riferimento: string; citatoDa: Set<number> }>();
  for (const f of analizzate) {
    for (const r of f.nota?.rinvii ?? []) {
      const k = chiaveRinvio(r);
      if (!k) continue;
      const voce = perChiave.get(k) ?? { riferimento: r, citatoDa: new Set<number>() };
      voce.citatoDa.add(f.n);
      perChiave.set(k, voce);
    }
  }
  const presente = (k: string) => {
    const [num, anno] = k.split("/");
    const reNum = new RegExp(`(?<!\\d)0*${num}(?!\\d)`);
    return tutte.some((f) => f.anno === anno && reNum.test(f.titolo));
  };
  return [...perChiave.entries()]
    .filter(([k]) => !presente(k))
    .map(([, v]) => ({ riferimento: v.riferimento, citatoDa: [...v.citatoDa].sort((a, b) => a - b) }))
    .sort((a, b) => b.citatoDa.length - a.citatoDa.length)
    .slice(0, 14);
}

/** Sezione finale deterministica: superate, lacune, copertura del database. */
export function sezioneAvvertenze(
  analizzate: FonteStudio[],
  menzioni: number,
  lacune: Array<{ riferimento: string; citatoDa: number[] }>
): string {
  const righe: string[] = [];
  const superate = analizzate.filter((f) => f.nota?.stato === "superato");
  if (superate.length) {
    righe.push("**Fonti indicate come superate** (da leggere solo per la ricostruzione storica):");
    for (const f of superate) righe.push(`- ${f.titolo} (${f.anno === "0000" ? "s.d." : f.anno}) [F${f.n}]`);
    righe.push("");
  }
  if (lacune.length) {
    righe.push("**Norme richiamate dalle fonti ma non presenti nel database** (passaggi non verificabili qui):");
    for (const l of lacune) righe.push(`- ${l.riferimento} — citata da ${l.citatoDa.map((n) => `[F${n}]`).join(" ")}`);
    righe.push("");
  }
  const anni = analizzate.map((f) => f.anno).filter((a) => a !== "0000").sort();
  righe.push(
    `**Copertura del database.** Il dossier analizza in dettaglio ${analizzate.length} fonti${
      anni.length ? `, dal ${anni[0]} al ${anni[anni.length - 1]}` : ""
    }${menzioni ? `; altre ${menzioni} fonti che citano l'argomento in modo marginale sono elencate nell'indice delle fonti` : ""}. Atti non presenti nel database non sono considerati: verificare sempre il testo vigente sulle fonti ufficiali.`
  );
  return righe.join("\n");
}
