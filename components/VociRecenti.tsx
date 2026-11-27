"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { StatoVoce, VoceImportata } from "@/lib/aggiornamenti/tipi";
import { docUrl } from "@/lib/docs";

const ETICHETTE: Record<StatoVoce, string> = {
  importato: "importato",
  duplicato: "duplicato",
  non_pertinente: "non pertinente",
  errore: "errore",
  needs_ocr: "da OCR",
};

const TONI: Partial<Record<StatoVoce, string>> = {
  importato: "border-[#0a7a3433] bg-[#0a7a340d] text-[#0a6b2e] dark:text-[#5fd38d]",
  errore: "border-[#ee000033] bg-[#ee00000d] text-[#c50000] dark:text-[#ff6666]",
  needs_ocr: "border-[#b4530933] bg-[#b453090d] text-[#9a4a07] dark:text-[#f5b86a]",
};

const dataBreve = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Rome" });
};

/** Atti rilevati dal controllo automatico, filtrabili per esito. */
export function VociRecenti({ voci }: { voci: VoceImportata[] }) {
  const [filtro, setFiltro] = useState<StatoVoce | "tutti">("tutti");
  const conteggi = useMemo(() => {
    const c = new Map<StatoVoce, number>();
    for (const v of voci) c.set(v.stato, (c.get(v.stato) ?? 0) + 1);
    return c;
  }, [voci]);
  const visibili = filtro === "tutti" ? voci : voci.filter((v) => v.stato === filtro);

  if (!voci.length) {
    return <p className="rounded-ds border border-dashed border-hairline p-5 text-center text-[13.5px] text-mute">Nessun atto catastale importato finora.</p>;
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filtra per esito">
        {(["tutti", ...([...conteggi.keys()] as StatoVoce[])] as Array<StatoVoce | "tutti">).map((s) => {
          const attivo = filtro === s;
          return (
            <button
              key={s}
              onClick={() => setFiltro(s)}
              aria-pressed={attivo}
              className={`rounded-full border px-2.5 py-1 text-[12px] font-medium transition ${
                attivo ? "border-ink bg-ink text-canvas" : "border-hairline bg-canvas text-body hover:border-hairline-strong"
              }`}
            >
              {s === "tutti" ? "Tutti" : ETICHETTE[s]}
              <span className={`ml-1 font-mono text-[10.5px] ${attivo ? "text-canvas/70" : "text-mute"}`}>{s === "tutti" ? voci.length : conteggi.get(s)}</span>
            </button>
          );
        })}
      </div>
      {filtro === "needs_ocr" && (
        <p className="mb-3 rounded-ds border border-hairline bg-canvas-soft px-3.5 py-2.5 text-[12.5px] leading-relaxed text-body">
          PDF scansionati senza testo: nessun OCR a pagamento. Dal tuo PC, con tesseract installato, <code className="font-mono">npm run ocr:locale</code>{" "}
          estrae il testo e li importa nel corpus (istruzioni in DEPLOY.md).
        </p>
      )}
      <ul className="divide-y divide-hairline overflow-hidden rounded-ds-lg border border-hairline bg-canvas shadow-ds">
        {visibili.map((v) => (
          <li key={v.url} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-3">
            <span className="flex min-w-0 flex-1 flex-col">
              {v.docId ? (
                <Link href={`/documento/${v.docId}`} className="line-clamp-2 text-[13.5px] font-medium text-ink hover:text-link">
                  {v.titolo}
                </Link>
              ) : (
                <a href={docUrl(v.cartella, v.url)} target="_blank" rel="noopener noreferrer" className="line-clamp-2 text-[13.5px] font-medium text-ink hover:text-link">
                  {v.titolo}
                </a>
              )}
              <span className="text-[12px] text-mute">
                {v.cartella || v.fonte} · {v.data ? dataBreve(v.data) : v.anno ?? "s.d."}
                {v.motivo ? ` · ${v.motivo}` : ""}
                {v.urlArchivio && (
                  <>
                    {" · "}
                    <a href={v.urlArchivio} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-ink">
                      copia d&apos;archivio
                    </a>
                  </>
                )}
              </span>
            </span>
            <span className={`self-start rounded-full border px-2 py-0.5 text-[11px] font-medium sm:self-center ${TONI[v.stato] ?? "border-hairline bg-canvas-soft text-body"}`}>
              {ETICHETTE[v.stato] ?? v.stato}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
