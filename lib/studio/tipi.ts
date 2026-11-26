/**
 * Tipi condivisi (server e client) dello Studio Normativo.
 * Nessuna dipendenza: importabile dai componenti client.
 */

export type RuoloFonte =
  | "istitutivo" // introduce l'istituto o la disciplina
  | "modifica" // modifica o integra norme precedenti
  | "chiarimento" // interpreta, chiarisce
  | "operativo" // istruzioni, procedure, software, modelli
  | "abrogazione" // abroga o supera
  | "giurisprudenza" // sentenze
  | "contesto"; // cita l'argomento solo di passaggio

export type StatoFonte = "vigente" | "superato" | "incerto";

export type OrigineConcetto = "argomento" | "morfologia" | "tesauro" | "ai" | "semantica";

export interface ConcettoEspanso {
  etichetta: string;
  /** Espressione FTS5 usata (mostrata per trasparenza). */
  espressione: string;
  origine: OrigineConcetto;
  /** Peso nel punteggio: 1 = nucleo dell'argomento, <1 = correlato. */
  peso: number;
  /** Documenti del corpus che la contengono. */
  documenti: number;
}

export interface NotaFonte {
  estremi: string;
  ruolo: RuoloFonte;
  stato: StatoFonte;
  sintesi: string;
  novita: string;
  rinvii: string[];
  /** true se la nota e' stata ricavata senza modello (ripiego). */
  automatica?: boolean;
}

export interface FonteStudio {
  /** Numero di citazione: [F{n}] nel testo. Ordine cronologico. */
  n: number;
  id: number;
  titolo: string;
  anno: string; // "2023" oppure "0000"
  cartella: string;
  tipo: string;
  url: string;
  livello: "analizzata" | "menzione";
  /** Rilevanza 0-100. */
  punteggio: number;
  concetti: string[];
  inTitolo: boolean;
  semantica: boolean;
  /**
   * Anno probabilmente errato nei metadati del DB: il testo cita questo anno,
   * successivo a quello registrato (es. una nota "del 1917" sul servizio
   * online del 2026).
   */
  annoDubbio?: number;
  /** Estratti pertinenti (testo semplice, l'evidenziazione la fa il client). */
  passaggi: string[];
  nota?: NotaFonte;
}

export interface SezioneDossier {
  id: string;
  titolo: string;
  markdown: string;
}

export interface VoceTimeline {
  anno: string;
  n: number;
  ruolo: RuoloFonte;
  stato: StatoFonte;
  cambiamento: string;
}

export interface LacunaDossier {
  riferimento: string;
  /** Fonti [F n] che la citano. */
  citatoDa: number[];
}

export interface VerificheDossier {
  citazioniTotali: number;
  citazioniValide: number;
  citazioniRimosse: number;
  /** Riferimenti normativi nel testo generato che non compaiono negli estratti. */
  riferimentiNonVerificati: string[];
  /** Fonti analizzate mai citate nel testo (restano in timeline e indice). */
  fontiNonCitate: number[];
}

export interface StatisticheDossier {
  trovate: number;
  analizzate: number;
  menzioni: number;
  perTipo: Record<string, number>;
  daAnno: string | null;
  aAnno: string | null;
  durataMs: number;
  chiamateAi: number;
  modello: string;
}

export interface Dossier {
  versione: 1;
  chiave: string;
  argomento: string;
  creatoIl: string;
  versioneCorpus: { documenti: number; maxId: number };
  espansione: ConcettoEspanso[];
  /** Sorgenti regex (flag "gi") per evidenziare i termini lato client. */
  evidenzia: string[];
  fonti: FonteStudio[];
  sezioni: SezioneDossier[];
  timeline: VoceTimeline[];
  lacune: LacunaDossier[];
  superate: number[];
  verifiche: VerificheDossier;
  statistiche: StatisticheDossier;
  avvisi: string[];
}

export type FaseStudio = "cache" | "espansione" | "ricerca" | "estratti" | "analisi" | "stesura" | "verifica";

/** Eventi dello stream NDJSON di /api/studio (una riga JSON per evento). */
export type EventoStudio =
  | { tipo: "fase"; fase: FaseStudio; messaggio: string; progresso?: number }
  | { tipo: "espansione"; concetti: ConcettoEspanso[]; evidenzia: string[] }
  | { tipo: "fonti"; fonti: FonteStudio[]; statistiche: Pick<StatisticheDossier, "trovate" | "analizzate" | "menzioni" | "perTipo" | "daAnno" | "aAnno"> }
  | { tipo: "note"; note: Array<{ n: number; nota: NotaFonte }>; fatte: number; totali: number }
  | { tipo: "sezione_inizio"; id: string; titolo: string }
  | { tipo: "delta"; id: string; testo: string }
  | { tipo: "sezione_fine"; id: string; markdown: string }
  | { tipo: "fine"; dossier: Dossier; cache: boolean; nuoveFonti?: number }
  /** `grave`: limita il dossier (es. quota AI esaurita), mostrato in evidenza. */
  | { tipo: "avviso"; messaggio: string; grave?: boolean }
  | { tipo: "errore"; messaggio: string }
  /** Keep-alive durante le chiamate lunghe al modello (ignorato dal client). */
  | { tipo: "ping" };

export interface DossierRecente {
  chiave: string;
  argomento: string;
  creatoIl: string;
  fonti: number;
  analizzate: number;
}
