import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/lib/db";
import { archivioDi } from "@/lib/aggiornamenti/r2";
import { docUrl, fmtAnno, isImportatoWeb } from "@/lib/docs";
import { SiteHeader } from "@/components/SiteHeader";
import { EvidenziaDocumento } from "@/components/EvidenziaDocumento";
import { ExternalIcon } from "@/components/icons";

/**
 * Lettore del testo integrale di un documento del corpus: piu' leggibile del
 * PDF su smartphone (testo che si adatta allo schermo, ricerca dei termini),
 * con il collegamento all'originale. Generato alla prima visita e messo in
 * cache (ISR): il testo di un atto non cambia.
 */

export const revalidate = 86400;
export function generateStaticParams() {
  return [];
}

const MAX_CARATTERI = 400_000;

interface Doc {
  id: number;
  titolo: string;
  anno: string;
  cartella: string;
  nomeFile: string;
  url: string;
  testo: string;
  lunghezza: number;
}

const carica = cache(async (id: number): Promise<Doc | null> => {
  if (!Number.isInteger(id) || id <= 0) return null;
  try {
    const rs = await getDb().execute({
      sql: `SELECT id, titolo, anno, cartella_origine AS cartella, nuovo_nome_file AS nomeFile,
                   substr(testo_estratto, 1, ${MAX_CARATTERI}) AS testo, length(testo_estratto) AS lunghezza
            FROM documenti WHERE id = ?`,
      args: [id],
    });
    const r = rs.rows[0];
    if (!r) return null;
    const cartella = String(r.cartella ?? "");
    const nomeFile = String(r.nomeFile ?? "");
    return {
      id,
      titolo: String(r.titolo ?? "") || nomeFile,
      anno: fmtAnno(r.anno),
      cartella,
      nomeFile,
      url: docUrl(cartella, nomeFile),
      testo: String(r.testo ?? ""),
      lunghezza: Number(r.lunghezza ?? 0),
    };
  } catch (err) {
    console.error(`[/documento/${id}] errore:`, err);
    throw err;
  }
});

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  try {
    const d = await carica(Number(params.id));
    return d ? { title: d.titolo, description: `${d.cartella} · ${d.anno === "0000" ? "s.d." : d.anno}` } : { title: "Documento" };
  } catch {
    return { title: "Documento" };
  }
}

/** Paragrafi dal testo estratto: ricuce gli a-capo tipografici, tiene commi ed elenchi. */
function paragrafi(testo: string): string[] {
  const out: string[] = [];
  let cur = "";
  const inizioUnita = /^(?:\d{1,3}[.)]\s|[a-zA-Z][)]\s|[-–—•·*▪]\s|art(?:\.|icolo)\s*\d|comma\s+\d|capo\s+[IVXLC0-9]|titolo\s+[IVXLC0-9])/i;
  for (const grezza of testo.split(/\r?\n/)) {
    const riga = grezza.replace(/[ \t]+/g, " ").trim();
    if (!riga) {
      if (cur) out.push(cur);
      cur = "";
      continue;
    }
    if (cur && inizioUnita.test(riga)) {
      out.push(cur);
      cur = riga;
    } else cur = cur ? `${cur} ${riga}` : riga;
  }
  if (cur) out.push(cur);
  return out;
}

export default async function DocumentoPage({ params }: { params: { id: string } }) {
  const d = await carica(Number(params.id));
  if (!d) notFound();
  // Copia d'archivio su R2 (atti importati dal cron): ripiego se l'AdE sposta il PDF.
  const archivio = isImportatoWeb(d.nomeFile) ? await archivioDi(getDb(), Number(params.id)) : null;
  const blocchi = paragrafi(d.testo);
  const troncato = d.lunghezza > MAX_CARATTERI;

  return (
    <main className="min-h-dvh px-4 pb-24 pt-5 sm:pt-8">
      <SiteHeader attiva="documento" />

      <article className="mx-auto mt-8 max-w-3xl">
        <header className="mb-6 border-b border-hairline pb-5">
          <p className="font-mono text-[11.5px] uppercase tracking-[0.14em] text-mute">
            {d.cartella} · {d.anno === "0000" ? "s.d." : d.anno}
            {isImportatoWeb(d.nomeFile) && " · importato automaticamente"}
          </p>
          <h1 className="mt-2 break-words text-[24px] font-semibold leading-tight tracking-display-sm text-ink sm:text-[28px]">{d.titolo}</h1>
          <div className="mt-4 flex flex-wrap gap-2 print:hidden">
            <a
              href={d.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-ds bg-ink px-3.5 py-2 text-[13.5px] font-medium text-canvas transition hover:opacity-90"
            >
              Apri il PDF originale <ExternalIcon className="h-3.5 w-3.5" />
            </a>
            {archivio?.urlPubblico && (
              <a
                href={archivio.urlPubblico}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-ds border border-hairline bg-canvas px-3.5 py-2 text-[13.5px] font-medium text-ink transition hover:bg-canvas-soft"
              >
                Copia d&apos;archivio <ExternalIcon className="h-3.5 w-3.5" />
              </a>
            )}
            <Link
              href={`/studio?argomento=${encodeURIComponent(d.titolo.replace(/^[A-Za-zà-ù.]+\s*\d*\s*-\s*/, "").slice(0, 80))}`}
              className="inline-flex items-center gap-2 rounded-ds border border-hairline bg-canvas px-3.5 py-2 text-[13.5px] font-medium text-ink transition hover:bg-canvas-soft"
            >
              Studia l&apos;argomento
            </Link>
          </div>
          <p className="mt-3 text-[12px] text-mute">
            Testo estratto automaticamente dal PDF (può contenere errori di riconoscimento): per citazioni e adempimenti fa fede il documento originale.
          </p>
        </header>

        <EvidenziaDocumento contenitoreId="testo-documento" />

        {blocchi.length === 0 ? (
          <p className="rounded-ds border border-dashed border-hairline p-6 text-center text-[14px] text-mute">
            Nessun testo estratto per questo documento: apri il PDF originale.
          </p>
        ) : (
          <div id="testo-documento" className="space-y-3 text-[15.5px] leading-[1.75] text-body sm:text-[16px]">
            {blocchi.map((p, i) => (
              <p key={i} className="break-words">
                {p}
              </p>
            ))}
          </div>
        )}
        {troncato && (
          <p className="mt-6 rounded-ds border border-hairline bg-canvas-soft p-4 text-[13px] text-body">
            Il documento è molto lungo: qui ne sono mostrati i primi {MAX_CARATTERI.toLocaleString("it-IT")} caratteri. Il testo completo è nel PDF originale.
          </p>
        )}
      </article>
    </main>
  );
}
