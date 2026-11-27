import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { conSegreto } from "@/lib/autorizza";
import { NO_STORE } from "@/lib/http";
import { indicizzaImportati } from "@/lib/aggiornamenti/indicizza";

/**
 * Cron giornaliero (vercel.json): riprende l'indicizzazione semantica dove si
 * era fermata (ricostruzione dell'indice, atti importati il lunedi' rimasti in
 * coda, documenti cambiati). Ogni giorno al massimo VECTORIZE_NEURONI_GIORNO
 * neuroni e mai oltre il tetto di dimensioni memorizzate; se non c'e' nulla da
 * fare termina in pochi millisecondi senza chiamate AI.
 *
 * Autenticazione: `Authorization: Bearer <CRON_SECRET>` (inviato da Vercel).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET non configurato." }, { status: 503, headers: { "Cache-Control": NO_STORE } });
  }
  if (!conSegreto(req)) return NextResponse.json({ ok: false, error: "Non autorizzato." }, { status: 401, headers: { "Cache-Control": NO_STORE } });
  const esito = await indicizzaImportati(getDb(), [], 270_000);
  console.log(
    `[cron indicizza] ${esito.documenti} documenti, ${esito.vettori} passaggi, ${esito.neuroni} neuroni, ${esito.residui} residui${esito.arresto ? ` · ${esito.arresto}` : ""}`
  );
  return NextResponse.json({ ok: true, esito }, { headers: { "Cache-Control": NO_STORE } });
}
