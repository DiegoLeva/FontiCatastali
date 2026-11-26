/**
 * Tipi condivisi (server e client) dell'aggiornamento automatico della
 * normativa. Nessuna dipendenza: importabile anche dai componenti client.
 */

export type EsitoEsecuzione =
  | "in_corso"
  | "ok" // novita' importate senza errori
  | "nessuna_novita" // fonti controllate, niente di nuovo
  | "parziale" // qualcosa e' andato storto ma il resto ha funzionato
  | "errore" // nessuna fonte controllata con successo
  | "saltata" // un'altra esecuzione era gia' in corso
  | "interrotta"; // rimasta "in_corso" oltre il tempo massimo (timeout)

export type InnescoEsecuzione = "cron" | "manuale" | "prova";

export type StatoVoce =
  | "importato"
  | "duplicato" // gia' presente nel corpus (stesso tipo/numero/anno)
  | "non_pertinente" // non riguarda catasto / pubblicita' immobiliare
  | "errore"; // download o estrazione non riusciti (ritentato)

export interface StatoFonte {
  id: string;
  nome: string;
  url: string;
  ok: boolean;
  httpStatus: number | null;
  voci: number;
  nuove: number;
  ms: number;
  errore?: string;
}

export interface EsecuzioneRiepilogo {
  id: number;
  avviataIl: string;
  conclusaIl: string | null;
  durataMs: number | null;
  innesco: InnescoEsecuzione;
  esito: EsitoEsecuzione;
  fontiControllate: number;
  fontiInErrore: number;
  vociLette: number;
  nuoveVoci: number;
  pertinenti: number;
  importati: number;
  duplicati: number;
  scartati: number;
  errori: number;
  messaggio: string;
  fonti?: StatoFonte[];
  dettagliErrori?: string[];
}

export interface VoceImportata {
  url: string;
  fonte: string;
  tipo: string;
  numero: string | null;
  data: string | null;
  anno: number | null;
  titolo: string;
  cartella: string;
  docId: number | null;
  stato: StatoVoce;
  motivo: string | null;
  semantico: string | null;
  importatoIl: string | null;
}

export interface StatoAggiornamenti {
  generatoIl: string;
  configurazione: {
    cronSecret: boolean;
    turso: boolean;
    cloudflare: boolean;
    webhook: boolean;
  };
  pianificazione: {
    cron: string;
    descrizione: string;
    prossima: string;
  };
  documenti: number;
  ultimaEsecuzione: EsecuzioneRiepilogo | null;
  ultimoSuccesso: EsecuzioneRiepilogo | null;
  esecuzioni: EsecuzioneRiepilogo[];
  voci: VoceImportata[];
  avvisi: string[];
  error?: string;
}

/** Versione compatta per la riga di stato nella home. */
export interface StatoAggiornamentiBreve {
  documenti: number;
  ultimoControllo: string | null;
  ultimoEsito: EsitoEsecuzione | null;
  ultimoSuccesso: string | null;
  importatiUltimi30gg: number;
}
