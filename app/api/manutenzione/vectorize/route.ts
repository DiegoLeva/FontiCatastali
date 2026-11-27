import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { conSegreto, inAnteprima } from "@/lib/autorizza";
import { NO_STORE } from "@/lib/http";
import { indicizzaDocumenti, statoRicostruzione } from "@/lib/ai/indice";
import { prenotaQueryVectorize, statoVectorize } from "@/lib/ai/vectorize";
import { conServizioAi, statoBudget } from "@/lib/ai/budget";
import { embed, quotaEsaurita, vectorSearchIds } from "@/lib/cloudflare";

/**
 * Manutenzione dell'indice semantico (vedi lib/ai/indice.ts).
 *
 *   GET /api/manutenzione/vectorize                 -> stato e piano (nessuna chiamata AI)
 *   GET /api/manutenzione/vectorize?azione=esegui    -> indicizza a lotti (idempotente)
 *       &neuroni=N  tetto di neuroni per questa esecuzione (sempre entro quello giornaliero)
 *       &secondi=S  durata massima (default 270)
 *   GET /api/manutenzione/vectorize?azione=prova&q=  -> 10 documenti piu' vicini (1 query)
 *
 * Produzione: serve `Authorization: Bearer <CRON_SECRET>`. Anteprime (protette
 * da Vercel Authentication) e sviluppo: consentito senza header.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const json = (dati: unknown, status = 200) => NextResponse.json(dati, { status, headers: { "Cache-Control": NO_STORE } });

export async function GET(req: NextRequest) {
  if (!conSegreto(req) && !inAnteprima()) return json({ error: "Non autorizzato." }, 401);
  const sp = req.nextUrl.searchParams;
  const azione = sp.get("azione") ?? "stato";
  const db = getDb();
  try {
    if (azione === "esegui") {
      const neuroni = Number(sp.get("neuroni"));
      const secondi = Math.min(280, Math.max(10, Number(sp.get("secondi")) || 270));
      const esito = await indicizzaDocumenti(db, {
        budgetMs: secondi * 1000,
        maxNeuroni: Number.isFinite(neuroni) && neuroni > 0 ? neuroni : undefined,
      });
      return json({ esito, vectorize: await statoVectorize(), ai: await statoBudget() });
    }
    if (azione === "prova") {
      const q = (sp.get("q") ?? "").trim().slice(0, 300);
      if (!q) return json({ error: "Parametro q mancante." }, 400);
      if (!(await prenotaQueryVectorize())) return json({ error: "Ricerca semantica non disponibile ora.", vectorize: await statoVectorize() }, 409);
      const risultati = await conServizioAi("altro", async () => vectorSearchIds(await embed(q), 20));
      const perDoc = new Map<number, number>();
      for (const m of risultati) {
        const id = Number(String(m.id).split("-")[0]);
        if (Number.isFinite(id) && !perDoc.has(id)) perDoc.set(id, m.score);
      }
      const ids = [...perDoc.keys()].slice(0, 10);
      const titoli = ids.length
        ? await db.execute({ sql: `SELECT id, titolo, anno FROM documenti WHERE id IN (${ids.map(() => "?").join(",")})`, args: ids })
        : { rows: [] };
      const perId = new Map(titoli.rows.map((r) => [Number(r.id), `${r.titolo} (${r.anno})`]));
      return json({ q, risultati: ids.map((id) => ({ id, punteggio: Math.round((perDoc.get(id) ?? 0) * 1000) / 1000, titolo: perId.get(id) ?? "" })) });
    }
    const [ricostruzione, vectorize, ai] = await Promise.all([statoRicostruzione(db), statoVectorize(), statoBudget()]);
    return json({ ricostruzione, vectorize, ai });
  } catch (err) {
    if (quotaEsaurita(err)) return json({ error: (err as Error).message }, 503);
    console.error("[/api/manutenzione/vectorize] errore:", err);
    return json({ error: (err as Error).message.slice(0, 300) }, 500);
  }
}
