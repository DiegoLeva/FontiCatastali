import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { conSegreto, inAnteprima } from "@/lib/autorizza";
import { NO_STORE } from "@/lib/http";
import { importaGazzetta, registraControllo } from "@/lib/aggiornamenti/gazzetta";
import { indicizzaImportati } from "@/lib/aggiornamenti/indicizza";
import { eseguiBonifica } from "@/lib/metadati/bonifica";
import { confrontaNuoviAtti } from "@/lib/watchlist/server";

/**
 * Cron giornaliero (vercel.json, 03:17 UTC):
 *   1. Gazzetta Ufficiale: il numero del giorno (feed RSS ufficiale), solo gli
 *      atti con termini catastali, con la stessa verifica sul testo e la stessa
 *      deduplica del cron del lunedi'; nessun modello AI;
 *   2. metadati normalizzati e argomenti seguiti per gli atti nuovi;
 *   3. indicizzazione semantica: riprende dove si era fermata (ricostruzione
 *      dell'indice, atti del lunedi' in coda), entro VECTORIZE_NEURONI_GIORNO
 *      neuroni e il tetto di dimensioni memorizzate.
 * Se non c'e' nulla da fare termina in pochi secondi senza chiamate AI.
 *
 * Autenticazione: `Authorization: Bearer <CRON_SECRET>` (inviato da Vercel).
 * Nelle anteprime (protette da Vercel Authentication) ?prova=1 controlla la
 * Gazzetta a secco, senza scrivere.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const json = (dati: unknown, status = 200) => NextResponse.json(dati, { status, headers: { "Cache-Control": NO_STORE } });

export async function GET(req: NextRequest) {
  const prova = req.nextUrl.searchParams.get("prova") === "1";
  if (!(conSegreto(req) || (prova && inAnteprima()))) {
    if (!process.env.CRON_SECRET) return json({ ok: false, error: "CRON_SECRET non configurato." }, 503);
    return json({ ok: false, error: "Non autorizzato." }, 401);
  }
  const t0 = Date.now();
  const db = getDb();
  const gazzetta = await importaGazzetta(db, { prova, budgetMs: 70_000 });
  if (prova) return json({ ok: true, prova: true, gazzetta });
  await registraControllo(db, gazzetta).catch((err) => console.warn("[cron giornaliero] registro della Gazzetta:", (err as Error).message));
  const extra: string[] = [];
  if (gazzetta.idImportati.length) {
    await eseguiBonifica(db, { applica: true, ids: gazzetta.idImportati }).catch((err) => extra.push(`metadati: ${(err as Error).message}`));
    await confrontaNuoviAtti(db, gazzetta.idImportati).catch((err) => extra.push(`argomenti seguiti: ${(err as Error).message}`));
  }
  const indice = await indicizzaImportati(db, gazzetta.idImportati, Math.max(20_000, 270_000 - (Date.now() - t0)));
  console.log(
    `[cron giornaliero] Gazzetta: ${gazzetta.letti} atti, ${gazzetta.pertinenti} pertinenti, ${gazzetta.importati} importati${gazzetta.errore ? ` (${gazzetta.errore})` : ""} · indice: ${indice.documenti} documenti, ${indice.neuroni} neuroni, ${indice.residui} residui${indice.arresto ? ` · ${indice.arresto}` : ""}`
  );
  return json({ ok: true, gazzetta, indice, avvisi: extra });
}
