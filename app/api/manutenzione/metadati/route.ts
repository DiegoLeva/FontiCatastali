import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { conSegreto, inAnteprima } from "@/lib/autorizza";
import { eseguiBonifica } from "@/lib/metadati/bonifica";
import { NO_STORE } from "@/lib/http";

/**
 * Bonifica dei metadati del corpus (vedi lib/metadati/bonifica.ts).
 *
 *   GET /api/manutenzione/metadati            -> prova a secco: rapporto, nessuna scrittura
 *   GET /api/manutenzione/metadati?applica=1  -> applica (idempotente, rieseguibile)
 *   ?da=<id>                                  -> riprende da un id (esecuzioni a tappe)
 *
 * Produzione: serve `Authorization: Bearer <CRON_SECRET>`. Anteprime (protette
 * da Vercel Authentication) e sviluppo: consentito senza header.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!conSegreto(req) && !inAnteprima()) {
    return NextResponse.json({ error: "Non autorizzato." }, { status: 401, headers: { "Cache-Control": NO_STORE } });
  }
  const sp = req.nextUrl.searchParams;
  const applica = sp.get("applica") === "1";
  const da = Number(sp.get("da") ?? 0);
  try {
    const r = await eseguiBonifica(getDb(), { applica, daId: Number.isFinite(da) && da > 0 ? da : undefined, budgetMs: 250_000 });
    const limite = Math.min(2000, Math.max(0, Number(sp.get("righe") ?? 300) || 0));
    return NextResponse.json(
      { ...r, modifiche: r.modifiche.slice(0, limite), revisione: r.revisione.slice(0, limite), risoluzioni: r.risoluzioni.slice(0, limite) },
      { headers: { "Cache-Control": NO_STORE } }
    );
  } catch (err) {
    console.error("[/api/manutenzione/metadati] errore:", err);
    return NextResponse.json({ error: (err as Error).message.slice(0, 300) }, { status: 500, headers: { "Cache-Control": NO_STORE } });
  }
}
