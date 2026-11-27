import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { clientIp, NO_STORE } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { argomentoValido, registraArgomento } from "@/lib/watchlist/server";

/**
 * Registro ANONIMO degli argomenti seguiti (nessun dato personale: solo
 * l'argomento e quante persone lo seguono). Serve al cron del lunedi' per
 * sapere quali argomenti confrontare con i nuovi atti.
 *   POST {argomento, azione: "segui" | "smetti"}
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const rl = rateLimit(`watchlist:${clientIp(req)}`, 30, 10 * 60_000);
  if (!rl.ok) return NextResponse.json({ ok: false }, { status: 429, headers: { "Retry-After": String(rl.retryAfter), "Cache-Control": NO_STORE } });
  let body: { argomento?: unknown; azione?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400, headers: { "Cache-Control": NO_STORE } });
  }
  const argomento = argomentoValido(body.argomento);
  const azione = body.azione === "smetti" ? "smetti" : "segui";
  if (!argomento) return NextResponse.json({ ok: false }, { status: 400, headers: { "Cache-Control": NO_STORE } });
  try {
    await registraArgomento(getDb(), argomento, azione);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": NO_STORE } });
  } catch (err) {
    console.error("[/api/watchlist] errore:", err);
    return NextResponse.json({ ok: false }, { status: 500, headers: { "Cache-Control": NO_STORE } });
  }
}
