import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { eseguiAggiornamento, notifica } from "@/lib/aggiornamenti/esegui";
import { FONTI } from "@/lib/aggiornamenti/fonti";
import type { InnescoEsecuzione } from "@/lib/aggiornamenti/tipi";
import { NO_STORE } from "@/lib/http";

/**
 * Aggiornamento automatico della normativa (cron del lunedi', vedi vercel.json).
 *
 * Autenticazione: Vercel invia `Authorization: Bearer <CRON_SECRET>` a ogni
 * invocazione del cron se la variabile CRON_SECRET e' definita nel progetto.
 * Senza segreto la route rifiuta tutto (fail closed): nessuno puo' far
 * scaricare PDF al server o scrivere nel corpus.
 *
 * Avvio manuale (stesso header):
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        "https://fonti-catastali.vercel.app/api/cron/aggiorna-normativa"
 * Parametri: ?prova=1 (a secco, nessuna scrittura) · ?limite=N · ?fonti=id1,id2
 *
 * Nelle anteprime (VERCEL_ENV=preview, protette da Vercel Authentication) la
 * sola prova a secco e' consentita anche senza header, per verificare le fonti
 * dalla rete di Vercel prima di un rilascio.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Download e testo dei PDF + LLM per i titoli: con Fluid Compute (vercel.json)
// 300 s sono il massimo anche sul piano Hobby; il lavoro si ferma a ~220 s.
export const maxDuration = 300;

function uguali(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

type Autorizzazione =
  | { ok: true; innesco: InnescoEsecuzione; prova: boolean }
  | { ok: false; status: number; messaggio: string };

function autorizza(req: NextRequest): Autorizzazione {
  const segreto = process.env.CRON_SECRET;
  const prova = req.nextUrl.searchParams.get("prova") === "1";
  const auth = req.headers.get("authorization") ?? "";

  if (segreto && uguali(auth, `Bearer ${segreto}`)) {
    const daCron = /vercel-cron/i.test(req.headers.get("user-agent") ?? "");
    return { ok: true, innesco: prova ? "prova" : daCron ? "cron" : "manuale", prova };
  }
  const anteprima = process.env.VERCEL_ENV === "preview" || process.env.NODE_ENV === "development";
  if (anteprima && prova) return { ok: true, innesco: "prova", prova: true };
  if (!segreto) {
    return {
      ok: false,
      status: 503,
      messaggio: "CRON_SECRET non configurato nel progetto Vercel: l'aggiornamento automatico è disattivato.",
    };
  }
  return { ok: false, status: 401, messaggio: "Non autorizzato." };
}

async function gestisci(req: NextRequest): Promise<NextResponse> {
  const a = autorizza(req);
  if (!a.ok) {
    return NextResponse.json({ ok: false, error: a.messaggio }, { status: a.status, headers: { "Cache-Control": NO_STORE } });
  }

  const sp = req.nextUrl.searchParams;
  // Attenzione: Number(null) === 0. Senza ?limite il limite deve restare quello
  // predefinito, non zero (bug trovato provando la route sull'anteprima).
  const limiteGrezzo = sp.get("limite");
  const limite = limiteGrezzo === null || limiteGrezzo.trim() === "" ? NaN : Number(limiteGrezzo);
  const idFonti = (sp.get("fonti") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => FONTI.some((f) => f.id === s));

  const rapporto = await eseguiAggiornamento({
    innesco: a.innesco,
    prova: a.prova,
    limiteImport: Number.isFinite(limite) && limite >= 0 ? Math.min(limite, 25) : undefined,
    fonti: idFonti.length ? idFonti : undefined,
  });

  // I nuovi atti entrano subito nella mappa degli argomenti (ISR di /api/topics).
  if (!rapporto.prova && (rapporto.importati > 0 || rapporto.ripristinati > 0)) {
    try {
      revalidatePath("/api/topics");
    } catch (err) {
      console.warn("[cron] revalidatePath non riuscito:", (err as Error).message);
    }
  }
  await notifica(rapporto);

  console.log(
    `[cron] aggiornamento ${rapporto.innesco}: ${rapporto.esito} in ${rapporto.durataMs} ms — ${rapporto.messaggio}`
  );
  if (rapporto.dettagliErrori.length) console.warn("[cron] dettagli:", rapporto.dettagliErrori.slice(0, 10).join(" | "));

  // Status non-2xx in caso di errore: il fallimento resta visibile anche nei
  // log dei Cron Jobs di Vercel, non solo nel registro su Turso.
  const status = rapporto.esito === "errore" ? 500 : 200;
  return NextResponse.json({ ok: rapporto.esito !== "errore", ...rapporto }, { status, headers: { "Cache-Control": NO_STORE } });
}

export const GET = gestisci;
// I "Schedules" di Vercel (successori dei Cron Jobs) usano POST di default.
export const POST = gestisci;
