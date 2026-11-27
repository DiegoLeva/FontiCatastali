"use client";

import { useMemo, useState } from "react";
import type { Dossier } from "@/lib/studio/tipi";
import { generaRipasso } from "@/lib/studio/didattica";

/**
 * Ripasso attivo del dossier (0 neuroni): flashcard da girare e quiz a
 * risposta multipla generati in modo deterministico dalla timeline, dagli
 * anni, dagli stati e dalle sintesi delle fonti.
 */
export function Ripasso({ dossier }: { dossier: Dossier }) {
  const { flashcard, quiz } = useMemo(() => generaRipasso(dossier), [dossier]);
  const [modo, setModo] = useState<"flashcard" | "quiz">("flashcard");
  const [carta, setCarta] = useState(0);
  const [girata, setGirata] = useState(false);
  const [risposte, setRisposte] = useState<Record<number, number>>({});

  if (!flashcard.length && !quiz.length) {
    return <p className="rounded-ds border border-dashed border-hairline p-6 text-center text-[14px] text-mute">Il dossier non ha abbastanza dati strutturati per il ripasso.</p>;
  }
  const corrette = Object.entries(risposte).filter(([i, r]) => quiz[Number(i)]?.corretta === r).length;
  const fc = flashcard[carta];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Tipo di ripasso">
        {(["flashcard", "quiz"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={modo === m}
            onClick={() => setModo(m)}
            className={`rounded-full border px-3 py-1.5 text-[13px] font-medium transition ${modo === m ? "border-ink bg-ink text-canvas" : "border-hairline bg-canvas text-body hover:border-hairline-strong"}`}
          >
            {m === "flashcard" ? `Flashcard (${flashcard.length})` : `Quiz (${quiz.length})`}
          </button>
        ))}
        <span className="text-[12px] text-mute">Generati dal dossier, senza AI: sempre gli stessi per questo argomento.</span>
      </div>

      {modo === "flashcard" && fc && (
        <div className="mt-5">
          <button
            onClick={() => setGirata((g) => !g)}
            aria-live="polite"
            className="flex min-h-[180px] w-full flex-col justify-center rounded-ds-lg border border-hairline bg-canvas p-6 text-left shadow-ds transition hover:border-hairline-strong"
          >
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-mute">
              {girata ? "Risposta" : "Domanda"} · {carta + 1}/{flashcard.length}
            </span>
            <span className={`mt-3 leading-relaxed ${girata ? "text-[15px] text-body" : "text-[17px] font-medium text-ink"}`}>{girata ? fc.retro : fc.fronte}</span>
            {girata && fc.n !== undefined && <span className="mt-3 font-mono text-[11px] text-mute">Fonte [F{fc.n}]</span>}
            {!girata && <span className="mt-4 text-[12px] text-mute">Tocca per vedere la risposta</span>}
          </button>
          <div className="mt-3 flex items-center justify-between gap-2">
            <button
              onClick={() => {
                setCarta((c) => Math.max(0, c - 1));
                setGirata(false);
              }}
              disabled={carta === 0}
              className="rounded-ds border border-hairline bg-canvas px-3 py-2 text-[13px] text-body transition hover:border-hairline-strong disabled:opacity-40"
            >
              ← Precedente
            </button>
            <button
              onClick={() => {
                setCarta((c) => Math.min(flashcard.length - 1, c + 1));
                setGirata(false);
              }}
              disabled={carta >= flashcard.length - 1}
              className="rounded-ds bg-ink px-3 py-2 text-[13px] font-medium text-canvas transition hover:opacity-90 disabled:opacity-40"
            >
              Successiva →
            </button>
          </div>
        </div>
      )}

      {modo === "quiz" && (
        <div className="mt-5 space-y-5">
          <p className="text-[13px] text-body" aria-live="polite">
            Risposte corrette: <span className="font-semibold text-ink tabular-nums">{corrette}</span> su {Object.keys(risposte).length} date ({quiz.length} domande)
            {Object.keys(risposte).length > 0 && (
              <button onClick={() => setRisposte({})} className="ml-2 text-link underline underline-offset-4">
                Ricomincia
              </button>
            )}
          </p>
          {quiz.map((q, i) => {
            const data = risposte[i];
            return (
              <fieldset key={i} className="rounded-ds-lg border border-hairline bg-canvas p-4 shadow-ds">
                <legend className="px-1 text-[14px] font-medium leading-snug text-ink">
                  {i + 1}. {q.domanda}
                </legend>
                <div className="mt-2 grid gap-2">
                  {q.opzioni.map((o, j) => {
                    const scelta = data === j;
                    const giusta = data !== undefined && j === q.corretta;
                    return (
                      <button
                        key={j}
                        onClick={() => data === undefined && setRisposte((r) => ({ ...r, [i]: j }))}
                        disabled={data !== undefined}
                        className={`rounded-ds border px-3 py-2 text-left text-[13.5px] transition ${
                          giusta
                            ? "border-[#0a7a34] bg-[#0a7a340d] text-[#0a6b2e] dark:text-[#5fd38d]"
                            : scelta
                              ? "border-[#c50000] bg-[#ee00000d] text-[#c50000] dark:text-[#ff6666]"
                              : "border-hairline bg-canvas text-body hover:border-hairline-strong disabled:hover:border-hairline"
                        }`}
                      >
                        {o}
                      </button>
                    );
                  })}
                </div>
                {data !== undefined && (
                  <p className="mt-2 text-[12.5px] leading-relaxed text-body">
                    {data === q.corretta ? "Esatto. " : "Non è così. "}
                    {q.spiegazione}
                    {q.n !== undefined && <span className="ml-1 font-mono text-[11px] text-mute">[F{q.n}]</span>}
                  </p>
                )}
              </fieldset>
            );
          })}
        </div>
      )}
    </div>
  );
}
