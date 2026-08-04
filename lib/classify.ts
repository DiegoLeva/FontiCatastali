/**
 * Classificatore per argomenti — deterministico, basato sul lessico.
 *
 * Perche' non embedding: su contenuto giuridico la spiegabilita' conta piu'
 * della sfumatura. Una regola si legge, si discute e si corregge in una riga;
 * un vettore che archivia male una circolare e' opaco. Il corpus e' chiuso e
 * di dimensioni modeste, quindi il vantaggio semantico non compensa la perdita
 * di controllo.
 *
 * Prestazioni: il confronto ingenuo (ogni termine contro ogni documento)
 * sarebbe ~1M di scansioni su testo. Qui si usa un indice invertito:
 *   - i termini di una sola parola si risolvono con un lookup sul set di token
 *     del documento;
 *   - le locuzioni si testano solo se la loro parola piu' lunga compare tra i
 *     token, evitando la quasi totalita' dei confronti.
 * Il risultato viene tenuto in cache di modulo per un'ora.
 */

import { getDb } from "./db";
import { NODI, NODO_RESIDUO } from "./taxonomy";
import type { CatalogDoc } from "./types";

const DOCS_BASE_URL = process.env.NEXT_PUBLIC_DOCS_BASE_URL || "/docs";
const CACHE_TTL_MS = 60 * 60 * 1000;
/** Porzione iniziale del testo estratto usata per la classificazione. */
const INCIPIT_CHARS = 2000;

/* -------------------------------------------------------------------------- */
/* Normalizzazione                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Minuscole, senza diacritici, con apostrofi tipografici ricondotti a `'`.
 * Deve restare coerente con il modo in cui sono scritti i lessici.
 */
export function normalizza(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[‘’ʼ´`]/g, "'")
    .replace(/\s+/g, " ");
}

/** Token alfanumerici del testo normalizzato. */
function tokenizza(testo: string): Set<string> {
  const out = new Set<string>();
  for (const t of testo.split(/[^a-z0-9]+/)) if (t) out.add(t);
  return out;
}

/* -------------------------------------------------------------------------- */
/* Indice dei termini                                                          */
/* -------------------------------------------------------------------------- */

interface Locuzione {
  /** Regex con confini, gia' compilata. */
  re: RegExp;
  nodi: string[];
}

interface IndiceTermini {
  /** parola singola -> nodi da assegnare */
  parole: Map<string, string[]>;
  /** token di prefiltro -> locuzioni da verificare */
  locuzioni: Map<string, Locuzione[]>;
}

/**
 * Confini di parola estesi anche alla barra, perche' i codici di categoria si
 * scrivono `D/10`: senza escludere `/` il termine "categoria d" verrebbe
 * riconosciuto dentro "categoria d/10", che e' tutt'altro argomento.
 */
function confineRegex(termine: string): RegExp {
  const esc = termine.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9/])${esc}(?![a-z0-9/])`);
}

/** Parola alfanumerica piu' lunga: e' il token usato per prefiltrare. */
function tokenPrefiltro(termine: string): string {
  let best = "";
  for (const t of termine.split(/[^a-z0-9]+/)) if (t.length > best.length) best = t;
  return best;
}

const INDICE: IndiceTermini = (() => {
  const parole = new Map<string, string[]>();
  const locuzioni = new Map<string, Locuzione[]>();
  const perTermine = new Map<string, string[]>();

  // Un termine puo' comparire in piu' nodi: si raccolgono prima le occorrenze.
  for (const nodo of NODI.values()) {
    for (const grezzo of nodo.lessico) {
      const termine = normalizza(grezzo).trim();
      if (!termine) continue;
      const lista = perTermine.get(termine);
      if (lista) lista.push(nodo.id);
      else perTermine.set(termine, [nodo.id]);
    }
  }

  for (const [termine, nodi] of perTermine) {
    if (/^[a-z0-9]+$/.test(termine)) {
      parole.set(termine, nodi);
      continue;
    }
    const chiave = tokenPrefiltro(termine);
    if (!chiave) continue;
    const voce: Locuzione = { re: confineRegex(termine), nodi };
    const lista = locuzioni.get(chiave);
    if (lista) lista.push(voce);
    else locuzioni.set(chiave, [voce]);
  }

  return { parole, locuzioni };
})();

/* -------------------------------------------------------------------------- */
/* Classificazione                                                             */
/* -------------------------------------------------------------------------- */

export interface Indice {
  /** Totale documenti nel corpus. */
  totale: number;
  /** Documenti intercettati da almeno una regola. */
  classificati: number;
  /** id nodo -> documenti del nodo e di tutti i suoi discendenti. */
  perNodo: Map<string, CatalogDoc[]>;
  costruitoIl: number;
}

function buildUrl(cartella: string, nomeFile: string): string {
  return `${DOCS_BASE_URL}/${encodeURIComponent(cartella)}/${encodeURIComponent(
    nomeFile
  )}`;
}

function fmtAnno(a: unknown): string {
  const n = typeof a === "bigint" ? Number(a) : Number(a ?? 0);
  return n > 0 ? String(n).padStart(4, "0") : "0000";
}

const SQL = `
  SELECT id, cartella_origine AS cartella, nuovo_nome_file AS nomeFile,
         titolo, anno, tema,
         substr(testo_estratto, 1, ${INCIPIT_CHARS}) AS incipit
  FROM documenti;
`;

/** Nodi cui appartiene un documento, gia' propagati agli antenati. */
function nodiDelDocumento(testo: string): Set<string> {
  const token = tokenizza(testo);
  const diretti = new Set<string>();

  for (const t of token) {
    const nodi = INDICE.parole.get(t);
    if (nodi) for (const id of nodi) diretti.add(id);

    const candidate = INDICE.locuzioni.get(t);
    if (candidate) {
      for (const loc of candidate) {
        if (loc.re.test(testo)) for (const id of loc.nodi) diretti.add(id);
      }
    }
  }

  // Propagazione agli antenati: i documenti di un nodo comprendono sempre
  // quelli dei suoi discendenti.
  const conAntenati = new Set<string>();
  for (const id of diretti) {
    let cur: string | undefined = id;
    while (cur && !conAntenati.has(cur)) {
      conAntenati.add(cur);
      cur = NODI.get(cur)?.parent || undefined;
    }
  }
  return conAntenati;
}

async function costruisciIndice(): Promise<Indice> {
  const db = getDb();
  const rs = await db.execute(SQL);

  const perNodo = new Map<string, CatalogDoc[]>();
  let classificati = 0;

  for (const row of rs.rows) {
    const cartella = String(row.cartella ?? "");
    const nomeFile = String(row.nomeFile ?? "");
    const titolo = String(row.titolo ?? "");
    const doc: CatalogDoc = {
      id: Number(row.id),
      titolo,
      anno: fmtAnno(row.anno),
      nomeFile,
      url: buildUrl(cartella, nomeFile),
    };

    const testo = normalizza(
      [cartella, nomeFile, titolo, String(row.tema ?? ""), String(row.incipit ?? "")].join(" ")
    );

    const nodi = nodiDelDocumento(testo);
    if (nodi.size === 0) {
      const lista = perNodo.get(NODO_RESIDUO);
      if (lista) lista.push(doc);
      else perNodo.set(NODO_RESIDUO, [doc]);
      continue;
    }

    classificati++;
    for (const id of nodi) {
      const lista = perNodo.get(id);
      if (lista) lista.push(doc);
      else perNodo.set(id, [doc]);
    }
  }

  // Piu' recenti in cima, a parita' d'anno in ordine di titolo.
  for (const lista of perNodo.values()) {
    lista.sort(
      (a, b) => b.anno.localeCompare(a.anno) || a.titolo.localeCompare(b.titolo)
    );
  }

  return {
    totale: rs.rows.length,
    classificati,
    perNodo,
    costruitoIl: Date.now(),
  };
}

let cache: Indice | null = null;
let inFlight: Promise<Indice> | null = null;

/** Indice classificato, ricostruito al piu' una volta all'ora. */
export async function getIndice(): Promise<Indice> {
  if (cache && Date.now() - cache.costruitoIl < CACHE_TTL_MS) return cache;
  if (inFlight) return inFlight;

  inFlight = costruisciIndice()
    .then((idx) => {
      cache = idx;
      return idx;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}
