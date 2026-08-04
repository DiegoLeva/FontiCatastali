/**
 * Classificatore per argomenti — deterministico, basato sul lessico.
 *
 * Perche' non embedding: su contenuto giuridico la spiegabilita' conta piu'
 * della sfumatura. Una regola si legge, si discute e si corregge in una riga;
 * un vettore che archivia male una circolare e' opaco.
 *
 * QUANDO avviene il lavoro pesante: **in fase di build**, non a ogni richiesta.
 * `scripts/build-topics.ts` scarica il corpus una volta sola, classifica e
 * scrive `lib/topics-index.json`; a runtime si legge solo quel file. Senza
 * questo passaggio ogni avvio a freddo della funzione serverless avrebbe
 * dovuto riscaricare qualche megabyte di testo da Turso e rifare il lavoro,
 * ed e' esattamente cio' che rendeva lenta la mappa.
 *
 * Resta la strada di riserva: se l'indice precalcolato manca (sviluppo locale
 * senza credenziali al momento del build) si classifica al volo, con cache di
 * modulo. Piu' lento, ma la mappa funziona lo stesso.
 */

import { getDb } from "./db";
import { NODI, NODO_RESIDUO } from "./taxonomy";
import precalcolato from "./topics-index.json";
import type { CatalogDoc } from "./types";

const DOCS_BASE_URL = process.env.NEXT_PUBLIC_DOCS_BASE_URL || "/docs";
const CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Caratteri di `testo_estratto` usati per la classificazione. In fase di build
 * si puo' essere generosi (il costo si paga una volta); nella strada di riserva
 * a runtime si resta bassi per non appesantire ogni avvio a freddo.
 */
export const INCIPIT_BUILD = 4000;
const INCIPIT_RUNTIME = 1500;

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

/**
 * Nodi cui appartiene un documento, gia' propagati agli antenati: i documenti
 * di un nodo comprendono sempre quelli dei suoi discendenti.
 *
 * L'indice invertito evita il confronto ingenuo (ogni termine contro ogni
 * documento): le parole singole si risolvono con un lookup sul set di token, le
 * locuzioni si testano solo se la loro parola piu' lunga compare tra i token.
 */
export function nodiDelDocumento(testoNormalizzato: string): Set<string> {
  const token = tokenizza(testoNormalizzato);
  const diretti = new Set<string>();

  for (const t of token) {
    const nodi = INDICE.parole.get(t);
    if (nodi) for (const id of nodi) diretti.add(id);

    const candidate = INDICE.locuzioni.get(t);
    if (candidate) {
      for (const loc of candidate) {
        if (loc.re.test(testoNormalizzato)) for (const id of loc.nodi) diretti.add(id);
      }
    }
  }

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

/** Testo su cui si cerca: metadati curati piu' l'incipit del documento. */
export function testoDaClassificare(r: {
  cartella: string;
  nomeFile: string;
  titolo: string;
  tema: string;
  incipit: string;
}): string {
  return normalizza(
    [r.cartella, r.nomeFile, r.titolo, r.tema, r.incipit].join(" ")
  );
}

/* -------------------------------------------------------------------------- */
/* Indice dei documenti                                                        */
/* -------------------------------------------------------------------------- */

export interface Indice {
  totale: number;
  classificati: number;
  /** id nodo -> documenti del nodo e di tutti i suoi discendenti. */
  perNodo: Map<string, CatalogDoc[]>;
  /** true se i dati vengono dall'indice costruito in fase di build. */
  precalcolato: boolean;
  costruitoIl: number;
}

/** [id, cartella, nomeFile, titolo, anno] — forma compatta su disco. */
export type DocTuple = [number, string, string, string, string];

export interface IndicePrecalcolato {
  generato: boolean;
  creatoIl: string;
  totale: number;
  classificati: number;
  docs: DocTuple[];
  /** id nodo -> indici dentro `docs` */
  nodi: Record<string, number[]>;
}

function buildUrl(cartella: string, nomeFile: string): string {
  return `${DOCS_BASE_URL}/${encodeURIComponent(cartella)}/${encodeURIComponent(
    nomeFile
  )}`;
}

export function fmtAnno(a: unknown): string {
  const n = typeof a === "bigint" ? Number(a) : Number(a ?? 0);
  return n > 0 ? String(n).padStart(4, "0") : "0000";
}

/**
 * L'URL del bucket si compone a runtime, non in fase di build: cambiare
 * `NEXT_PUBLIC_DOCS_BASE_URL` non deve costringere a rigenerare l'indice.
 */
function daPrecalcolato(p: IndicePrecalcolato): Indice {
  const docs: CatalogDoc[] = p.docs.map(([id, cartella, nomeFile, titolo, anno]) => ({
    id,
    titolo,
    anno,
    nomeFile,
    url: buildUrl(cartella, nomeFile),
  }));

  const perNodo = new Map<string, CatalogDoc[]>();
  for (const [nodo, indici] of Object.entries(p.nodi)) {
    perNodo.set(nodo, indici.map((i) => docs[i]).filter(Boolean));
  }

  return {
    totale: p.totale,
    classificati: p.classificati,
    perNodo,
    precalcolato: true,
    costruitoIl: Date.now(),
  };
}

const SQL_RUNTIME = `
  SELECT id, cartella_origine AS cartella, nuovo_nome_file AS nomeFile,
         titolo, anno, tema,
         substr(testo_estratto, 1, ${INCIPIT_RUNTIME}) AS incipit
  FROM documenti;
`;

/** Strada di riserva: classificazione al volo quando manca il precalcolato. */
async function daDatabase(): Promise<Indice> {
  const db = getDb();
  const rs = await db.execute(SQL_RUNTIME);

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

    const nodi = nodiDelDocumento(
      testoDaClassificare({
        cartella,
        nomeFile,
        titolo,
        tema: String(row.tema ?? ""),
        incipit: String(row.incipit ?? ""),
      })
    );

    const destinazioni = nodi.size === 0 ? [NODO_RESIDUO] : [...nodi];
    if (nodi.size > 0) classificati++;
    for (const id of destinazioni) {
      const lista = perNodo.get(id);
      if (lista) lista.push(doc);
      else perNodo.set(id, [doc]);
    }
  }

  for (const lista of perNodo.values()) {
    lista.sort(
      (a, b) => b.anno.localeCompare(a.anno) || a.titolo.localeCompare(b.titolo)
    );
  }

  return {
    totale: rs.rows.length,
    classificati,
    perNodo,
    precalcolato: false,
    costruitoIl: Date.now(),
  };
}

let cache: Indice | null = null;
let inFlight: Promise<Indice> | null = null;

export async function getIndice(): Promise<Indice> {
  // Il JSON e' generato: TypeScript ne inferisce le tuple come array larghi.
  const p = precalcolato as unknown as IndicePrecalcolato;
  if (p.generato) {
    // Nessuna lettura dal database: costa solo la mappatura degli URL.
    if (!cache || !cache.precalcolato) cache = daPrecalcolato(p);
    return cache;
  }

  if (cache && Date.now() - cache.costruitoIl < CACHE_TTL_MS) return cache;
  if (inFlight) return inFlight;

  inFlight = daDatabase()
    .then((idx) => {
      cache = idx;
      return idx;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}
