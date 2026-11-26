import { NextRequest, NextResponse } from "next/server";
import { leggiStato, leggiStatoBreve } from "@/lib/aggiornamenti/stato";
import { CACHE_CDN_MINUTO, NO_STORE } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stato pubblico dell'aggiornamento automatico: ultima esecuzione, ultimo
 * successo, registro recente, atti importati e avvisi. Nessun segreto esce da
 * qui (solo se una variabile e' configurata, mai il suo valore).
 * `?breve=1` restituisce la versione compatta usata dalla home.
 */
export async function GET(req: NextRequest) {
  const breve = req.nextUrl.searchParams.get("breve") === "1";
  try {
    const dati = breve ? await leggiStatoBreve() : await leggiStato();
    return NextResponse.json(dati, { headers: { "Cache-Control": CACHE_CDN_MINUTO } });
  } catch (err) {
    console.error("[/api/aggiornamenti/stato] errore:", err);
    return NextResponse.json(
      { error: "Impossibile leggere lo stato degli aggiornamenti." },
      { status: 500, headers: { "Cache-Control": NO_STORE } }
    );
  }
}
