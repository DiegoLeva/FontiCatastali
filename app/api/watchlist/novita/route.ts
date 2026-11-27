import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { CACHE_CDN_BREVE, NO_STORE } from "@/lib/http";
import { argomentoValido, novitaPerArgomenti } from "@/lib/watchlist/server";

/**
 * Nuovi atti (importati dal controllo automatico) per gli argomenti seguiti.
 *   GET ?a=volture&a=F/3&dal=2026-11-01
 * Calcolo deterministico (FTS + espansione dello Studio), nessun modello AI.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const argomenti = [...new Set(sp.getAll("a").map(argomentoValido).filter((a): a is string => !!a))].slice(0, 20);
  const unAnnoFa = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
  const dalGrezzo = (sp.get("dal") ?? "").slice(0, 10);
  const dal = /^\d{4}-\d{2}-\d{2}$/.test(dalGrezzo) && dalGrezzo > unAnnoFa ? dalGrezzo : unAnnoFa;
  if (!argomenti.length) return NextResponse.json({ dal, totale: 0, argomenti: [] }, { headers: { "Cache-Control": CACHE_CDN_BREVE } });
  try {
    const risultati = await novitaPerArgomenti(getDb(), argomenti, dal);
    const totale = new Set(risultati.flatMap((r) => r.atti.map((a) => a.id))).size;
    return NextResponse.json({ dal, totale, argomenti: risultati }, { headers: { "Cache-Control": CACHE_CDN_BREVE } });
  } catch (err) {
    console.error("[/api/watchlist/novita] errore:", err);
    return NextResponse.json({ error: "Novità non disponibili." }, { status: 500, headers: { "Cache-Control": NO_STORE } });
  }
}
