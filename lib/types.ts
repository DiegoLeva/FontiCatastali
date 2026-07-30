/** Tipi condivisi client/server. */

/** Livello 3 — singolo file trovato. */
export interface FileHit {
  id: number;
  cartella: string;
  nomeFile: string;
  titolo: string;
  anno: string; // "2019" oppure "0000"
  url: string; // link al PDF (bucket o /docs)
  /** Snippet gia' sanificato: HTML sicuro contenente solo <mark>. */
  snippetHtml: string;
}

/** Livello 2 — cartella con conteggio. */
export interface FolderGroup {
  cartella: string;
  count: number; // n. file trovati in questa cartella
  files: FileHit[];
}

/** Faccetta di filtro per decennio. */
export interface DecadeFacet {
  key: string; // "2010" oppure "0000"
  label: string; // "Anni 2010" / "Senza data"
  count: number;
}

/** Risposta API /api/search. */
export interface SearchResponse {
  query: string;
  total: number;
  tookMs: number;
  groups: FolderGroup[];
  error?: string;
}
