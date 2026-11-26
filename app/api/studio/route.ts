import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { getDb } from "@/lib/db";
import { clientIp, CACHE_CDN_MINUTO, NO_STORE } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { chiaveArgomento, espandiArgomento, tokens, unioneFts } from "@/lib/studio/espansione";
import { consumaQuota, dossierRecenti, leggiCache } from "@/lib/studio/cache";
import { nuoveFontiDopo } from "@/lib/studio/recupero";
import { generaDossier } from "@/lib/studio/pipeline";
import { MAX_GENERAZIONI_GIORNO, MINIMO_NEURONI_DOSSIER, TETTO_DOSSIER } from "@/lib/studio/limiti";
import { disponibili } from "@/lib/ai/budget";
import { ripristinoQuota } from "@/lib/cloudflare";
import type { Dossier, EventoStudio } from "@/lib/studio/tipi";

/**
 * Studio Normativo (BETA).
 *
 *   POST /api/studio  {argomento, rigenera?}  -> stream NDJSON di EventoStudio
 *   GET  /api/studio?recenti=1                -> dossier generati di recente
 *   GET  /api/studio?argomento=…              -> dossier dalla cache (404 se assente)
 *   GET  /api/studio?argomento=…&genera=1     -> come il POST (link condivisibili e prove)
 *
 * Le generazioni consumano neuroni di Workers AI: si parte solo se il budget
 * gratuito di oggi lo consente (lib/ai/budget.ts), con al massimo 4 nuovi
 * dossier al giorno e un rate limit per IP. I dossier gia' in cache sono
 * gratuiti e illimitati; quelli obsoleti si rigenerano appena c'e' budget.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Con Fluid Compute (vercel.json) 300 s sono il massimo anche sul piano Hobby.
export const maxDuration = 300;

const RL_MAX = Number(process.env.STUDIO_MAX_PER_IP || 4);
const RL_WINDOW_MS = 10 * 60 * 1000;
const MAX_GIORNO = MAX_GENERAZIONI_GIORNO;
const MINIMO_NEURONI = MINIMO_NEURONI_DOSSIER;

function argomentoValido(raw: unknown): string | null {
  const a = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (a.length < 2 || tokens(a).length === 0) return null;
  return a;
}

const ndjson = (e: EventoStudio) => JSON.stringify(e) + "\n";

/**
 * Stream NDJSON del lavoro. Se il client si disconnette (scheda chiusa, rete
 * persa) la generazione NON si interrompe: si smette solo di scrivere sullo
 * stream, il dossier viene completato e salvato in cache, e l'utente lo
 * ritrova tra i "dossier gia' generati". `waitUntil` chiede a Vercel di tenere
 * viva la funzione fino alla fine del lavoro anche a risposta chiusa.
 */
function streamDi(lavoro: (emit: (e: EventoStudio) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  let chiuso = false;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  const emit = (e: EventoStudio) => {
    if (chiuso || !controllerRef) return;
    try {
      controllerRef.enqueue(encoder.encode(ndjson(e)));
    } catch {
      chiuso = true; // client andato via: il lavoro prosegue in silenzio
    }
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      // Keep-alive: proxy e browser non chiudono la connessione durante le
      // chiamate lunghe al modello.
      const ping = setInterval(() => emit({ tipo: "ping" }), 10_000);
      const esecuzione = lavoro(emit)
        .catch((err) => {
          console.error("[/api/studio] errore:", err);
          emit({ tipo: "errore", messaggio: "Si è verificato un errore durante la generazione del dossier. Riprova tra qualche istante." });
        })
        .finally(() => {
          clearInterval(ping);
          if (!chiuso) {
            chiuso = true;
            try {
              controller.close();
            } catch {
              /* gia' chiuso */
            }
          }
        });
      try {
        waitUntil(esecuzione);
      } catch {
        /* fuori da Vercel (sviluppo, test): la promessa prosegue comunque */
      }
    },
    cancel() {
      chiuso = true;
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": NO_STORE,
      "X-Accel-Buffering": "no",
    },
  });
}

function servi(salvato: Dossier, nuove: number, avviso?: string): Response {
  return streamDi(async (emit) => {
    emit({ tipo: "fase", fase: "cache", messaggio: "Dossier già generato: caricato dall'archivio." });
    if (avviso) emit({ tipo: "avviso", messaggio: avviso, grave: true });
    emit({ tipo: "fine", dossier: salvato, cache: true, nuoveFonti: nuove });
  });
}

function rifiuta(messaggio: string, salvato: Dossier | null, nuove: number, retryAfter?: number): Response {
  // Con una versione salvata (anche obsoleta) la si mostra con l'avviso.
  if (salvato) return servi(salvato, nuove, messaggio);
  return NextResponse.json(
    { error: messaggio },
    { status: 429, headers: { ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}), "Cache-Control": NO_STORE } }
  );
}

async function rispondi(req: NextRequest, argomento: string, rigenera: boolean): Promise<Response> {
  const db = getDb();
  const chiave = chiaveArgomento(argomento);
  const salvato = await leggiCache(db, chiave);
  const nuove = salvato ? await nuoveFontiDopo(db, unioneFts(espandiArgomento(argomento).concetti), salvato.versioneCorpus.maxId) : 0;

  // 1) Cache valida: istantanea, gratuita, senza limiti.
  if (salvato && !rigenera && !salvato.obsoleto) return servi(salvato, nuove);

  // 2) Serve una generazione (nuova, "Rigenera" o versione obsoleta).
  const { ora, secondi } = ripristinoQuota();
  const residuo = await disponibili("studio").catch(() => 0);
  if (residuo < MINIMO_NEURONI) {
    return rifiuta(
      salvato?.obsoleto
        ? `Questa versione del dossier è da aggiornare (${salvato.obsoleto}): verrà rigenerata automaticamente alla prossima apertura dopo le ${ora} (ora italiana), quando si azzera il budget AI gratuito.`
        : `Il budget AI gratuito di oggi per lo Studio è esaurito: nuove generazioni dalle ${ora} (ora italiana). I dossier già pronti restano consultabili.`,
      salvato,
      nuove,
      secondi
    );
  }
  const rl = rateLimit(`studio:${clientIp(req)}`, RL_MAX, RL_WINDOW_MS);
  if (!rl.ok) {
    return rifiuta(`Hai generato molti dossier in poco tempo: riprova tra ${Math.ceil(rl.retryAfter / 60)} minuti. I dossier già generati restano consultabili.`, salvato, nuove, rl.retryAfter);
  }
  const quota = await consumaQuota(db, MAX_GIORNO);
  if (!quota.ok) {
    return rifiuta(
      `Oggi sono già stati generati ${MAX_GIORNO} nuovi dossier: è il limite giornaliero per restare nella quota AI gratuita. Nuove generazioni dalle ${ora} (ora italiana); i dossier già pronti restano consultabili.`,
      salvato,
      nuove,
      secondi
    );
  }

  return streamDi(async (emit) => {
    await generaDossier(argomento, emit, undefined, { tettoNeuroni: Math.min(TETTO_DOSSIER, residuo) });
  });
}

export async function POST(req: NextRequest) {
  let body: { argomento?: unknown; rigenera?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Richiesta non valida." }, { status: 400, headers: { "Cache-Control": NO_STORE } });
  }
  const argomento = argomentoValido(body.argomento);
  if (!argomento) {
    return NextResponse.json({ error: "Scrivi un argomento di almeno 2 caratteri (es. «volture»)." }, { status: 400, headers: { "Cache-Control": NO_STORE } });
  }
  try {
    return await rispondi(req, argomento, body.rigenera === true);
  } catch (err) {
    console.error("[/api/studio] errore:", err);
    return NextResponse.json({ error: "Servizio temporaneamente non disponibile." }, { status: 500, headers: { "Cache-Control": NO_STORE } });
  }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  try {
    if (sp.get("recenti") === "1") {
      const recenti = await dossierRecenti(getDb(), 12);
      return NextResponse.json({ recenti }, { headers: { "Cache-Control": CACHE_CDN_MINUTO } });
    }
    const argomento = argomentoValido(sp.get("argomento"));
    if (!argomento) return NextResponse.json({ error: "Argomento mancante." }, { status: 400, headers: { "Cache-Control": NO_STORE } });
    if (sp.get("genera") === "1") return await rispondi(req, argomento, sp.get("rigenera") === "1");
    const db = getDb();
    const salvato = await leggiCache(db, chiaveArgomento(argomento));
    if (!salvato) return NextResponse.json({ error: "Dossier non ancora generato." }, { status: 404, headers: { "Cache-Control": NO_STORE } });
    const nuove = await nuoveFontiDopo(db, unioneFts(espandiArgomento(argomento).concetti), salvato.versioneCorpus.maxId);
    return NextResponse.json({ dossier: salvato, nuoveFonti: nuove }, { headers: { "Cache-Control": NO_STORE } });
  } catch (err) {
    console.error("[/api/studio] errore:", err);
    return NextResponse.json({ error: "Servizio temporaneamente non disponibile." }, { status: 500, headers: { "Cache-Control": NO_STORE } });
  }
}
