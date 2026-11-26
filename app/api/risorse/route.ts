import { NextResponse } from "next/server";
import { leggiStatoRisorse } from "@/lib/ai/stato";
import { NO_STORE } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Consumo delle risorse gratuite: neuroni Workers AI di oggi rispetto al
 * tetto, riserva di Normie e cron, dossier generati, quote Vectorize. Nessun
 * segreto: solo contatori e stati.
 */
export async function GET() {
  try {
    return NextResponse.json(await leggiStatoRisorse(), { headers: { "Cache-Control": NO_STORE } });
  } catch (err) {
    console.error("[/api/risorse] errore:", err);
    return NextResponse.json({ error: "Stato delle risorse non disponibile." }, { status: 500, headers: { "Cache-Control": NO_STORE } });
  }
}
