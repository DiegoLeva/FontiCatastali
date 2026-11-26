import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { docUrl, fmtAnno } from "@/lib/docs";
import { CACHE_CDN_LUNGA, NO_STORE } from "@/lib/http";
import type {
  CatalogCategory,
  CatalogResponse,
  CatalogYear,
} from "@/lib/types";

export const runtime = "nodejs";
// Resta dinamica (nessuna query al DB durante il build, che non deve dipendere
// da Turso), ma la risposta porta `s-maxage`: la CDN la serve per un'ora e la
// rinnova in background. Prima `force-dynamic` annullava il `revalidate` e ogni
// apertura di "Sfoglia per cartella" rileggeva da Turso tutti i 2187 documenti.
export const dynamic = "force-dynamic";

const CATALOG_SQL = `
  SELECT id, cartella_origine AS cartella, anno,
         titolo, nuovo_nome_file AS nomeFile
  FROM documenti
  ORDER BY cartella_origine ASC, anno DESC, titolo ASC;
`;

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
        url: docUrl(cartella, nomeFile),
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

    return NextResponse.json(
      { total: rs.rows.length, categorie },
      { headers: { "Cache-Control": CACHE_CDN_LUNGA } }
    );
  } catch (err) {
    console.error("[/api/catalog] errore:", err);
    return NextResponse.json(
      { total: 0, categorie: [], error: "Errore nel catalogo." },
      { status: 500, headers: { "Cache-Control": NO_STORE } }
    );
  }
}
