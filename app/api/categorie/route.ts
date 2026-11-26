import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { CACHE_CDN_LUNGA, NO_STORE } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface CategorieResponse {
  categorie: Array<{ cartella: string; count: number }>;
  error?: string;
}

/**
 * Elenco leggero delle cartelle con il numero di documenti.
 * Serve ai filtri di Normie, che prima scaricavano l'intero catalogo
 * (tutti i documenti con titolo e URL) solo per leggerne i nomi delle cartelle.
 */
export async function GET(): Promise<NextResponse<CategorieResponse>> {
  try {
    const rs = await getDb().execute(
      `SELECT cartella_origine AS cartella, COUNT(*) AS n
       FROM documenti GROUP BY cartella_origine ORDER BY cartella_origine`
    );
    return NextResponse.json(
      {
        categorie: rs.rows.map((r) => ({
          cartella: String(r.cartella ?? ""),
          count: Number(r.n ?? 0),
        })),
      },
      { headers: { "Cache-Control": CACHE_CDN_LUNGA } }
    );
  } catch (err) {
    console.error("[/api/categorie] errore:", err);
    return NextResponse.json(
      { categorie: [], error: "Impossibile leggere le categorie." },
      { status: 500, headers: { "Cache-Control": NO_STORE } }
    );
  }
}
