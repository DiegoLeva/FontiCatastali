"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { FonteStudio } from "@/lib/studio/tipi";
import { CloseIcon, DocIcon, ExternalIcon, ChevronIcon } from "@/components/icons";
import { Evidenziato } from "./testo";
import { RUOLI, STATI, annoBreve } from "./stile";

/**
 * Pannello della fonte citata: laterale su desktop, foglio dal basso su
 * mobile. Si apre sopra il dossier senza spostarne la posizione di lettura;
 * ESC o il velo chiudono e il focus torna al chip che l'ha aperto.
 */
export function FonteDrawer({
  fonte,
  re,
  query,
  onChiudi,
  onNaviga,
}: {
  fonte: FonteStudio | null;
  re: RegExp | null;
  query: string;
  onChiudi: () => void;
  onNaviga: (direzione: -1 | 1) => void;
}) {
  const chiudiRef = useRef<HTMLButtonElement>(null);
  const [copiato, setCopiato] = useState(false);

  useEffect(() => {
    if (!fonte) return;
    const t = setTimeout(() => chiudiRef.current?.focus(), 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onChiudi();
      if (e.key === "ArrowRight" && e.altKey) onNaviga(1);
      if (e.key === "ArrowLeft" && e.altKey) onNaviga(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [fonte, onChiudi, onNaviga]);

  useEffect(() => setCopiato(false), [fonte]);

  async function copiaRiferimento() {
    if (!fonte) return;
    const testo = `${fonte.titolo} (${annoBreve(fonte.anno)}) — ${fonte.tipo}, ${fonte.cartella}. ${new URL(fonte.url, window.location.href).toString()}`;
    try {
      await navigator.clipboard.writeText(testo);
      setCopiato(true);
    } catch {
      /* clipboard non disponibile */
    }
  }

  const nota = fonte?.nota;
  const lettore = fonte ? `/documento/${fonte.id}?q=${encodeURIComponent(query)}` : "#";

  return (
    <AnimatePresence>
      {fonte && (
        <>
          <motion.div
            key="velo"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={onChiudi}
            className="fixed inset-0 z-[60] bg-black/25 backdrop-blur-[1px] print:hidden"
            aria-hidden
          />
          <motion.aside
            key="pannello"
            role="dialog"
            aria-modal="true"
            aria-label={`Fonte F${fonte.n}: ${fonte.titolo}`}
            initial={{ opacity: 0, y: 24, x: 0 }}
            animate={{ opacity: 1, y: 0, x: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ type: "spring", stiffness: 420, damping: 36 }}
            className="fixed inset-x-0 bottom-0 z-[61] flex max-h-[88dvh] flex-col rounded-t-ds-lg border border-hairline bg-canvas shadow-ds-lg print:hidden sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[460px] sm:rounded-none sm:border-y-0 sm:border-r-0"
          >
            <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-hairline-strong sm:hidden" aria-hidden />
            <header className="flex shrink-0 items-start gap-3 border-b border-hairline px-5 pb-3 pt-3 sm:pt-5">
              <span className="mt-0.5 rounded-[6px] border border-link/30 bg-link-soft px-1.5 py-0.5 font-mono text-[11px] font-semibold text-link-deep dark:bg-[rgba(0,112,243,0.18)] dark:text-[#9ecbff]">
                F{fonte.n}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-mute">
                  {fonte.tipo} · {annoBreve(fonte.anno)}
                </p>
                <h2 className="mt-1 break-words text-[16px] font-semibold leading-snug tracking-[-0.01em] text-ink">{fonte.titolo}</h2>
                <p className="mt-1 truncate text-[12px] text-mute">{fonte.cartella}</p>
                {fonte.annoDubbio && (
                  <p className="mt-1.5 rounded-md bg-[#f9cb2826] px-2 py-1 text-[12px] text-[#9a4a07] dark:text-[#f5b86a]">
                    ⚠ Anno da verificare: il database indica {annoBreve(fonte.anno)}, ma il testo cita il {fonte.annoDubbio}.
                  </p>
                )}
              </div>
              <button
                ref={chiudiRef}
                onClick={onChiudi}
                aria-label="Chiudi"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-mute transition hover:bg-canvas-soft-2 hover:text-ink"
              >
                <CloseIcon className="h-5 w-5" />
              </button>
            </header>

            <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
              {nota && (
                <section className="mb-5">
                  <div className="mb-2.5 flex flex-wrap gap-1.5">
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${RUOLI[nota.ruolo].badge}`}>{RUOLI[nota.ruolo].label}</span>
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATI[nota.stato].badge}`}>{STATI[nota.stato].label}</span>
                    {fonte.livello === "menzione" && <span className="rounded-full border border-hairline px-2 py-0.5 text-[11px] text-mute">Menzione</span>}
                  </div>
                  {nota.estremi && (
                    <p className="mb-2 text-[13px] text-body">
                      <span className="font-medium text-ink">Estremi: </span>
                      {nota.estremi}
                    </p>
                  )}
                  <p className="text-[14px] leading-relaxed text-body">{nota.sintesi}</p>
                  {nota.novita && (
                    <p className="mt-2 text-[13.5px] leading-relaxed text-body">
                      <span className="font-medium text-ink">Cosa cambia: </span>
                      {nota.novita}
                    </p>
                  )}
                  {nota.rinvii.length > 0 && (
                    <p className="mt-2 text-[12.5px] text-mute">
                      <span className="font-medium text-body">Norme richiamate: </span>
                      {nota.rinvii.join(" · ")}
                    </p>
                  )}
                  <p className="mt-2 font-mono text-[10.5px] text-mute">
                    {nota.automatica ? "Sintesi estratta automaticamente dal testo." : "Sintesi generata dagli estratti qui sotto: verificala sul documento."}
                  </p>
                </section>
              )}

              <section>
                <h3 className="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-mute">
                  {fonte.passaggi.length > 1 ? "Passaggi pertinenti" : "Passaggio pertinente"}
                </h3>
                {fonte.passaggi.length === 0 ? (
                  <p className="text-[13px] italic text-mute">Nessun estratto testuale disponibile: apri il documento integrale.</p>
                ) : (
                  <div className="space-y-3">
                    {fonte.passaggi.map((p, i) => (
                      <blockquote key={i} className="rounded-ds border border-hairline bg-canvas-soft px-3.5 py-3 text-[13.5px] leading-[1.7] text-body">
                        <Evidenziato testo={p} re={re} />
                      </blockquote>
                    ))}
                  </div>
                )}
              </section>

              {fonte.concetti.length > 0 && (
                <p className="mt-4 text-[12px] text-mute">
                  Trovata per: {fonte.concetti.join(" · ")}
                  {fonte.semantica ? " · somiglianza semantica" : ""}
                </p>
              )}
            </div>

            <footer className="shrink-0 space-y-2 border-t border-hairline px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <div className="flex gap-2">
                <Link
                  href={lettore}
                  className="flex flex-1 items-center justify-center gap-2 rounded-ds bg-ink px-3 py-2.5 text-[13.5px] font-medium text-canvas transition hover:opacity-90"
                >
                  <DocIcon className="h-4 w-4" /> Leggi il testo integrale
                </Link>
                <a
                  href={fonte.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-1.5 rounded-ds border border-hairline px-3 py-2.5 text-[13.5px] font-medium text-ink transition hover:bg-canvas-soft"
                >
                  PDF <ExternalIcon className="h-3.5 w-3.5" />
                </a>
              </div>
              <div className="flex items-center justify-between gap-2 text-[12.5px]">
                <button onClick={() => onNaviga(-1)} className="flex items-center gap-1 rounded-md px-2 py-1.5 text-mute transition hover:bg-canvas-soft hover:text-ink">
                  <ChevronIcon className="h-3.5 w-3.5 rotate-180" /> Precedente
                </button>
                <button onClick={copiaRiferimento} className="rounded-md px-2 py-1.5 text-mute transition hover:bg-canvas-soft hover:text-ink">
                  {copiato ? "Riferimento copiato ✓" : "Copia riferimento"}
                </button>
                <button onClick={() => onNaviga(1)} className="flex items-center gap-1 rounded-md px-2 py-1.5 text-mute transition hover:bg-canvas-soft hover:text-ink">
                  Successiva <ChevronIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
