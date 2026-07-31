import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type {
  CatalogCategory,
  CatalogResponse,
  CatalogYear,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Il catalogo cambia di rado: cache CDN 1h (riduce le letture su Turso).
export const revalidate = 3600;

const DOCS_BASE_URL = process.env.NEXT_PUBLIC_DOCS_BASE_URL || "/docs";

const CATALOG_SQL = `
  SELECT id, cartella_origine AS cartella, anno,
         titolo, nuovo_nome_file AS nomeFile
  FROM documenti
  ORDER BY cartella_origine ASC, anno DESC, titolo ASC;
`;

function url(cartella: string, nomeFile: string): string {
  return `${DOCS_BASE_URL}/${encodeURIComponent(cartella)}/${encodeURIComponent(
    nomeFile
  )}`;
}

function fmtAnno(a: unknown): string {
  const n = typeof a === "bigint" ? Number(a) : Number(a ?? 0);
  return n > 0 ? String(n).padStart(4, "0") : "0000";
}

export async function GET(): Promise<NextResponse<CatalogResponse>> {
  try {
    const db = getDb();
    const rs = await db.execute(CATALOG_SQL);

    const cats = new Map<string, Map<string, CatalogYear>>();
    for (const row of rs.rows) {
      const cartella = String(row.cartella ?? "");
      const anno = fmtAnno(row.anno);
      const nomeFile = String(row.nomeFile ?? "");
      let years = cats.get(cartella);
      if (!years) cats.set(cartella, (years = new Map()));
      let y = years.get(anno);
      if (!y) years.set(anno, (y = { anno, count: 0, docs: [] }));
      y.count++;
      y.docs.push({
        id: Number(row.id),
        titolo: String(row.titolo ?? ""),
        anno,
        nomeFile,
        url: url(cartella, nomeFile),
      });
    }

    const categorie: CatalogCategory[] = Array.from(cats.entries())
      .map(([cartella, years]) => {
        // anni gia' in ordine di INSERIMENTO = DESC dalla query; "0000" in fondo
        const anni: CatalogYear[] = Array.from(years.values()).sort((a, b) => {
          if (a.anno === "0000") return 1;
          if (b.anno === "0000") return -1;
          return b.anno.localeCompare(a.anno);
        });
        const count = anni.reduce((s, y) => s + y.count, 0);
        return { cartella, count, anni };
      })
      .sort((a, b) => a.cartella.localeCompare(b.cartella));

    return NextResponse.json({ total: rs.rows.length, categorie });
  } catch (err) {
    console.error("[/api/catalog] errore:", err);
    return NextResponse.json(
      { total: 0, categorie: [], error: "Errore nel catalogo." },
      { status: 500 }
    );
  }
}
