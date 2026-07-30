import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  buildMatchQuery,
  snippetToSafeHtml,
  MARK_START,
  MARK_END,
} from "@/lib/fts";
import type { FileHit, FolderGroup, SearchResponse } from "@/lib/types";

// @libsql/client richiede il runtime Node (non Edge).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_RESULTS = 300;

/** Base URL dei PDF (bucket R2/Blob in produzione, /docs in locale). */
const DOCS_BASE_URL = process.env.NEXT_PUBLIC_DOCS_BASE_URL || "/docs";

/**
 * snippet(col=0=testo_estratto, open, close, ellissi, 64 token).
 * 64 e' il massimo FTS5: ~3 righe / ~150-200 caratteri per lato, keyword al
 * centro. I marcatori PUA vengono poi convertiti in <mark> lato server.
 * bm25 pesa piu' titolo/tema del corpo per una rilevanza migliore.
 */
const SEARCH_SQL = `
  SELECT
    d.id                        AS id,
    d.cartella_origine          AS cartella,
    d.nuovo_nome_file           AS nomeFile,
    d.titolo                    AS titolo,
    d.anno                      AS anno,
    snippet(documenti_fts, 0, '${MARK_START}', '${MARK_END}', ' … ', 64) AS snip,
    bm25(documenti_fts, 1.0, 8.0, 4.0) AS rank
  FROM documenti_fts
  JOIN documenti d ON d.id = documenti_fts.rowid
  WHERE documenti_fts MATCH ?
  ORDER BY rank
  LIMIT ${MAX_RESULTS};
`;

function buildFileUrl(cartella: string, nomeFile: string): string {
  return `${DOCS_BASE_URL}/${encodeURIComponent(cartella)}/${encodeURIComponent(
    nomeFile
  )}`;
}

function formatAnno(anno: unknown): string {
  const n = typeof anno === "bigint" ? Number(anno) : Number(anno ?? 0);
  return n > 0 ? String(n).padStart(4, "0") : "0000";
}

export async function GET(req: NextRequest): Promise<NextResponse<SearchResponse>> {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const match = buildMatchQuery(q);

  if (!match) {
    return NextResponse.json({ query: q, total: 0, tookMs: 0, groups: [] });
  }

  const t0 = Date.now();
  try {
    const db = getDb();
    const rs = await db.execute({ sql: SEARCH_SQL, args: [match] });

    // Raggruppa per cartella preservando l'ordine di rilevanza (rank).
    const byFolder = new Map<string, FileHit[]>();
    for (const row of rs.rows) {
      const cartella = String(row.cartella ?? "");
      const nomeFile = String(row.nomeFile ?? "");
      const rawSnip = String(row.snip ?? "");
      const hit: FileHit = {
        id: Number(row.id),
        cartella,
        nomeFile,
        titolo: String(row.titolo ?? ""),
        anno: formatAnno(row.anno),
        url: buildFileUrl(cartella, nomeFile),
        snippetHtml: snippetToSafeHtml(rawSnip),
      };
      const list = byFolder.get(cartella);
      if (list) list.push(hit);
      else byFolder.set(cartella, [hit]);
    }

    const groups: FolderGroup[] = Array.from(byFolder.entries())
      .map(([cartella, files]) => ({ cartella, count: files.length, files }))
      // cartelle piu' ricche di risultati in cima; a parita', ordine alfabetico
      .sort((a, b) => b.count - a.count || a.cartella.localeCompare(b.cartella));

    return NextResponse.json({
      query: q,
      total: rs.rows.length,
      tookMs: Date.now() - t0,
      groups,
    });
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
      { status: 500 }
    );
  }
}
