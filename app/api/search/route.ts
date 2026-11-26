import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  buildMatchQuery,
  snippetToSafeHtml,
  exactSnippetHtml,
  MARK_START,
  MARK_END,
} from "@/lib/fts";
import { docUrl, fmtAnno } from "@/lib/docs";
import { CACHE_CDN_BREVE, NO_STORE } from "@/lib/http";
import type { FileHit, FolderGroup, SearchResponse } from "@/lib/types";

// @libsql/client richiede il runtime Node (non Edge).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_RESULTS = 300;
/** Oltre questa lunghezza una query non e' una ricerca ma un incolla di testo. */
const MAX_QUERY_LEN = 200;
/**
 * La ricerca esatta scansiona il testo integrale di ogni documento (instr):
 * con 1-2 caratteri restituirebbe quasi tutto il corpus a costo pieno.
 */
const MIN_EXACT_LEN = 3;

/** Ricerca FTS5 (default): tokenizzata, accent-insensitive, con snippet+bm25. */
const FTS_SQL = `
  SELECT d.id AS id, d.cartella_origine AS cartella, d.nuovo_nome_file AS nomeFile,
    d.titolo AS titolo, d.anno AS anno,
    snippet(documenti_fts, 0, '${MARK_START}', '${MARK_END}', ' … ', 64) AS snip,
    bm25(documenti_fts, 1.0, 8.0, 4.0) AS rank
  FROM documenti_fts
  JOIN documenti d ON d.id = documenti_fts.rowid
  WHERE documenti_fts MATCH ?
  ORDER BY rank
  LIMIT ${MAX_RESULTS};
`;

/**
 * RICERCA ESATTA: match letterale della stringa (spazi inclusi), via instr().
 * lower() rende il match case-insensitive ma NON tocca gli spazi -> "il numero
 * di spazi" conta. Se la sottostringa esatta non c'e', nessun risultato.
 * snip = finestra di testo attorno alla prima occorrenza.
 */
const EXACT_SQL = `
  SELECT d.id AS id, d.cartella_origine AS cartella, d.nuovo_nome_file AS nomeFile,
    d.titolo AS titolo, d.anno AS anno,
    substr(d.testo_estratto,
           max(1, instr(lower(d.testo_estratto), lower(?)) - 130), 320) AS snip
  FROM documenti d
  WHERE instr(lower(d.testo_estratto), lower(?)) > 0
     OR instr(lower(d.titolo), lower(?)) > 0
  ORDER BY d.anno DESC
  LIMIT ${MAX_RESULTS};
`;

function rowToHit(row: Record<string, unknown>, snippetHtml: string): FileHit {
  const cartella = String(row.cartella ?? "");
  const nomeFile = String(row.nomeFile ?? "");
  return {
    id: Number(row.id),
    cartella,
    nomeFile,
    titolo: String(row.titolo ?? ""),
    anno: fmtAnno(row.anno),
    url: docUrl(cartella, nomeFile),
    snippetHtml,
  };
}

function groupByFolder(hits: FileHit[]): FolderGroup[] {
  const byFolder = new Map<string, FileHit[]>();
  for (const h of hits) {
    const list = byFolder.get(h.cartella);
    if (list) list.push(h);
    else byFolder.set(h.cartella, [h]);
  }
  return Array.from(byFolder.entries())
    .map(([cartella, files]) => ({ cartella, count: files.length, files }))
    .sort((a, b) => b.count - a.count || a.cartella.localeCompare(b.cartella));
}

function vuota(q: string, status = 200, error?: string) {
  return NextResponse.json<SearchResponse>(
    { query: q, total: 0, tookMs: 0, groups: [], ...(error ? { error } : {}) },
    { status, headers: { "Cache-Control": status === 200 ? CACHE_CDN_BREVE : NO_STORE } }
  );
}

export async function GET(
  req: NextRequest
): Promise<NextResponse<SearchResponse>> {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, MAX_QUERY_LEN);
  const exact = req.nextUrl.searchParams.get("exact") === "1";

  // In modalita' FTS servono almeno 2 caratteri utili; in esatta almeno 3.
  const match = exact ? q : buildMatchQuery(q);
  if (!q || (!exact && !match) || (exact && q.length < MIN_EXACT_LEN)) {
    return vuota(q);
  }

  const t0 = Date.now();
  try {
    const db = getDb();
    let hits: FileHit[];

    if (exact) {
      const rs = await db.execute({ sql: EXACT_SQL, args: [q, q, q] });
      hits = rs.rows.map((row) =>
        rowToHit(row, exactSnippetHtml(String(row.snip ?? ""), q))
      );
    } else {
      const rs = await db.execute({ sql: FTS_SQL, args: [match] });
      hits = rs.rows.map((row) =>
        rowToHit(row, snippetToSafeHtml(String(row.snip ?? "")))
      );
    }

    return NextResponse.json(
      {
        query: q,
        total: hits.length,
        tookMs: Date.now() - t0,
        groups: groupByFolder(hits),
      },
      // La stessa query restituisce lo stesso risultato finche' il corpus non
      // cambia: la CDN risponde alle ricerche ripetute senza toccare Turso.
      { headers: { "Cache-Control": CACHE_CDN_BREVE } }
    );
  } catch (err) {
    console.error("[/api/search] errore:", err);
    return NextResponse.json(
      {
        query: q,
        total: 0,
        tookMs: Date.now() - t0,
        groups: [],
        error: "Errore durante la ricerca. Riprova.",
      },
      { status: 500, headers: { "Cache-Control": NO_STORE } }
    );
  }
}
