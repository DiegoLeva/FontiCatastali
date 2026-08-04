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

/** ---- Catalogo (albero navigabile "Sfoglia") ---- */
export interface CatalogDoc {
  id: number;
  titolo: string;
  anno: string;
  nomeFile: string;
  url: string;
}
export interface CatalogYear {
  anno: string;
  count: number;
  docs: CatalogDoc[];
}
export interface CatalogCategory {
  cartella: string;
  count: number;
  anni: CatalogYear[];
}
export interface CatalogResponse {
  total: number;
  categorie: CatalogCategory[];
  error?: string;
}

/** ---- Argomenti (mappa mentale a 4 livelli) ---- */

/** Nodo dell'albero degli argomenti, con il conteggio dei documenti. */
export interface TopicNode {
  id: string; // "A", "A1", "A1.1", "A1.1.1"
  label: string;
  count: number; // documenti del nodo, discendenti inclusi
  figli: TopicNode[];
}

export interface TopicsResponse {
  /** Documenti nel corpus. */
  totale: number;
  /** Documenti intercettati da almeno un nodo. */
  classificati: number;
  /** Documenti che nessuna regola ha intercettato. */
  residuo: number;
  /** Nodi senza documenti, esclusi dall'albero: misura da tarare nel tempo. */
  nodiVuoti: number;
  aree: TopicNode[];
  error?: string;
}

/** Anello della briciola di pane. */
export interface TopicCrumb {
  id: string;
  label: string;
}

export interface TopicDocsResponse {
  id: string;
  label: string;
  percorso: TopicCrumb[];
  totale: number;
  docs: CatalogDoc[];
  error?: string;
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
