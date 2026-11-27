import type { Dossier, FonteStudio, RuoloFonte, StatoFonte, VoceTimeline } from "./tipi";

/**
 * Strumenti didattici dello Studio Normativo, tutti DETERMINISTICI (0 neuroni):
 * nascono dai dati strutturati del dossier gia' generato (fonti con anno,
 * ruolo, stato e sintesi; timeline dei cambiamenti), senza nuove chiamate AI.
 *
 *   - confrontaDate: norme gia' emanate a una data e quelle intervenute fino
 *     a una seconda data, con i cambiamenti dell'intervallo;
 *   - generaRipasso: flashcard e quiz a risposta multipla, sempre uguali per
 *     lo stesso dossier (generatore pseudo-casuale con seme fisso).
 */

export const ETICHETTE_RUOLO: Record<RuoloFonte, string> = {
  istitutivo: "Istituzione della disciplina",
  modifica: "Modifiche e integrazioni",
  chiarimento: "Chiarimenti e interpretazioni",
  operativo: "Istruzioni operative",
  abrogazione: "Abrogazioni e superamenti",
  giurisprudenza: "Giurisprudenza",
  contesto: "Contesto",
};

export const ETICHETTE_STATO: Record<StatoFonte, string> = { vigente: "Vigente", superato: "Superato", incerto: "Incerto" };

const annoNum = (a: string) => (/^\d{4}$/.test(a) && a !== "0000" ? Number(a) : null);

/** Nome dell'atto per lo studio: estremi normalizzati se ci sono, altrimenti il titolo. */
export function nomeAtto(f: FonteStudio): string {
  return (f.estremi || f.nota?.estremi || f.titolo).replace(/\s+/g, " ").trim();
}

/** Fonti utili alla didattica: analizzate, con anno valido. */
function fontiDatate(d: Dossier): FonteStudio[] {
  return d.fonti.filter((f) => f.livello === "analizzata" && annoNum(f.anno) !== null);
}

/** Anni distinti del dossier, dal piu' antico. */
export function anniDossier(d: Dossier): number[] {
  return [...new Set(fontiDatate(d).map((f) => annoNum(f.anno)!))].sort((a, b) => a - b);
}

export interface VoceConfronto {
  fonte: FonteStudio;
  /** Per le norme gia' emanate al primo anno: superata entro il secondo? */
  superataNellIntervallo?: boolean;
}

export interface Confronto {
  annoA: number;
  annoB: number;
  /** Norme gia' emanate entro annoA (dalla piu' recente). */
  giaEmanate: VoceConfronto[];
  /** Norme intervenute tra annoA (escluso) e annoB (incluso), per ruolo. */
  intervenute: Array<{ ruolo: RuoloFonte; etichetta: string; fonti: FonteStudio[] }>;
  /** Cambiamenti della timeline nell'intervallo, in ordine cronologico. */
  cambiamenti: VoceTimeline[];
  totaleIntervenute: number;
}

const ORDINE_RUOLI: RuoloFonte[] = ["istitutivo", "modifica", "abrogazione", "chiarimento", "operativo", "giurisprudenza", "contesto"];

export function confrontaDate(d: Dossier, annoA: number, annoB: number): Confronto {
  const [a, b] = annoA <= annoB ? [annoA, annoB] : [annoB, annoA];
  const datate = fontiDatate(d);
  const cambiamenti = d.timeline
    .filter((v) => {
      const n = annoNum(v.anno);
      return n !== null && n > a && n <= b;
    })
    .sort((x, y) => x.anno.localeCompare(y.anno) || x.n - y.n);
  // Una norma gia' emanata risulta superata nell'intervallo se oggi e'
  // superata e nell'intervallo c'e' un'abrogazione o una modifica.
  const svolta = cambiamenti.some((v) => v.ruolo === "abrogazione" || v.ruolo === "modifica");
  const giaEmanate = datate
    .filter((f) => annoNum(f.anno)! <= a)
    .sort((x, y) => annoNum(y.anno)! - annoNum(x.anno)! || x.n - y.n)
    .map((fonte) => ({ fonte, superataNellIntervallo: fonte.nota?.stato === "superato" && svolta }));
  const nellIntervallo = datate.filter((f) => annoNum(f.anno)! > a && annoNum(f.anno)! <= b);
  const intervenute = ORDINE_RUOLI.map((ruolo) => ({
    ruolo,
    etichetta: ETICHETTE_RUOLO[ruolo],
    fonti: nellIntervallo.filter((f) => (f.nota?.ruolo ?? "contesto") === ruolo).sort((x, y) => x.anno.localeCompare(y.anno) || x.n - y.n),
  })).filter((g) => g.fonti.length);
  return { annoA: a, annoB: b, giaEmanate, intervenute, cambiamenti, totaleIntervenute: nellIntervallo.length };
}

/* -------------------------------------------------------------------------- */
/* Ripasso                                                                     */
/* -------------------------------------------------------------------------- */

export interface Flashcard {
  fronte: string;
  retro: string;
  /** Fonte di riferimento [F n]. */
  n?: number;
}

export interface DomandaQuiz {
  domanda: string;
  opzioni: string[];
  corretta: number;
  spiegazione: string;
  n?: number;
}

/** Generatore pseudo-casuale con seme (mulberry32): stesso dossier, stesso ripasso. */
function generatore(seme: string): () => number {
  let h = 1779033703 ^ seme.length;
  for (let i = 0; i < seme.length; i++) {
    h = Math.imul(h ^ seme.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let t = h >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function mescola<T>(v: T[], caso: () => number): T[] {
  const a = [...v];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(caso() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const tronca = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max).replace(/\s+\S*$/, "")}…`);
const pulisci = (s: string) => s.replace(/\[\s*F\s*\d+[^\]]*\]/g, "").replace(/\s+/g, " ").trim();

/** Domanda con opzioni mescolate (la corretta e' la prima di `opzioni`). */
function domanda(testo: string, opzioni: string[], spiegazione: string, caso: () => number, n?: number): DomandaQuiz | null {
  const uniche = [...new Set(opzioni)];
  if (uniche.length < 3) return null;
  const mescolate = mescola(uniche, caso);
  return { domanda: testo, opzioni: mescolate, corretta: mescolate.indexOf(uniche[0]), spiegazione, n };
}

export function generaRipasso(d: Dossier, maxDomande = 12): { flashcard: Flashcard[]; quiz: DomandaQuiz[] } {
  const caso = generatore(`${d.chiave}|${d.creatoIl}`);
  const perN = new Map(d.fonti.map((f) => [f.n, f]));
  const datate = fontiDatate(d);
  const flashcard: Flashcard[] = [];

  // 1) Cambiamenti della timeline, in ordine cronologico.
  for (const v of [...d.timeline].sort((a, b) => a.anno.localeCompare(b.anno) || a.n - b.n)) {
    const f = perN.get(v.n);
    const cambiamento = pulisci(v.cambiamento);
    if (!f || !cambiamento) continue;
    flashcard.push({ fronte: `Che cosa cambia ${annoNum(v.anno) ? `nel ${v.anno} ` : ""}con ${nomeAtto(f)}?`, retro: cambiamento, n: v.n });
  }
  // 2) Di che cosa si occupa ciascun atto.
  for (const f of datate) {
    const sintesi = pulisci(f.nota?.sintesi ?? "");
    if (sintesi.length < 30) continue;
    flashcard.push({ fronte: `${nomeAtto(f)}: di che cosa si occupa?`, retro: sintesi, n: f.n });
  }
  // 3) Stato attuale.
  for (const f of datate) {
    const stato = f.nota?.stato;
    if (stato !== "vigente" && stato !== "superato") continue;
    flashcard.push({ fronte: `${nomeAtto(f)} è ancora in vigore?`, retro: stato === "vigente" ? "Sì: risulta vigente." : "No: risulta superato da atti successivi.", n: f.n });
  }

  const quiz: DomandaQuiz[] = [];
  const anni = anniDossier(d);
  // A) In che anno?
  for (const f of mescola(datate, caso).slice(0, 6)) {
    const giusto = annoNum(f.anno)!;
    const vicini = anni.filter((a) => a !== giusto).sort((x, y) => Math.abs(x - giusto) - Math.abs(y - giusto)).slice(0, 3);
    const q = domanda(`In che anno è stato emanato ${nomeAtto(f)}?`, [String(giusto), ...vicini.map(String)], `${nomeAtto(f)} è del ${giusto}.`, caso, f.n);
    if (q && vicini.length === 3) quiz.push(q);
  }
  // B) Quale atto ha disposto il cambiamento?
  const conCambiamento = d.timeline.filter((v) => perN.has(v.n) && pulisci(v.cambiamento).length >= 20);
  for (const v of mescola(conCambiamento, caso).slice(0, 5)) {
    const giusto = nomeAtto(perN.get(v.n)!);
    const altri = mescola(
      conCambiamento.filter((x) => x.n !== v.n).map((x) => nomeAtto(perN.get(x.n)!)).filter((x) => x !== giusto),
      caso
    ).slice(0, 3);
    const q = domanda(`Quale atto ha disposto: «${tronca(pulisci(v.cambiamento), 180)}»?`, [giusto, ...altri], `È ${giusto}${annoNum(v.anno) ? ` (${v.anno})` : ""}.`, caso, v.n);
    if (q && altri.length >= 2) quiz.push(q);
  }
  // C) Il piu' antico.
  const distinti = [...new Map(datate.map((f) => [annoNum(f.anno)!, f])).values()];
  for (let i = 0; i < 2 && distinti.length >= 4; i++) {
    const quattro = mescola(distinti, caso).slice(0, 4);
    const antico = quattro.reduce((m, f) => (annoNum(f.anno)! < annoNum(m.anno)! ? f : m));
    const q = domanda(
      "Quale di questi atti è il più antico?",
      [nomeAtto(antico), ...quattro.filter((f) => f !== antico).map(nomeAtto)],
      `${nomeAtto(antico)} è del ${antico.anno}: ${quattro.map((f) => `${nomeAtto(f)} (${f.anno})`).join(", ")}.`,
      caso,
      antico.n
    );
    if (q) quiz.push(q);
  }
  // D) Vigente o superato?
  for (const f of mescola(datate.filter((x) => x.nota?.stato === "vigente" || x.nota?.stato === "superato"), caso).slice(0, 3)) {
    const stato = ETICHETTE_STATO[f.nota!.stato];
    const q = domanda(`Qual è oggi lo stato di ${nomeAtto(f)}?`, [stato, ...Object.values(ETICHETTE_STATO).filter((s) => s !== stato)], `${nomeAtto(f)}: ${stato.toLowerCase()}.`, caso, f.n);
    if (q) quiz.push(q);
  }

  return { flashcard: flashcard.slice(0, 40), quiz: mescola(quiz, caso).slice(0, maxDomande) };
}
