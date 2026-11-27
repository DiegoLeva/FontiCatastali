"use client";

import { useId, useState } from "react";

interface Props {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}

/** Switch "Ricerca ibrida": testo + significato (Vectorize), fusi con RRF. */
export function HybridToggle({ value, onChange, disabled }: Props) {
  const [aiuto, setAiuto] = useState(false);
  const aiutoId = useId();

  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          role="switch"
          aria-checked={value}
          aria-disabled={disabled}
          aria-describedby={aiuto ? aiutoId : undefined}
          onClick={() => !disabled && onChange(!value)}
          className={`group flex items-center gap-2.5 rounded-full py-1 pr-1 focus:outline-none focus-visible:shadow-focus ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
        >
          <span
            className={`relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full border transition-colors ${
              value ? "border-link bg-link" : "border-hairline bg-canvas-soft-2"
            }`}
          >
            <span
              className={`inline-block h-[16px] w-[16px] rounded-full bg-canvas shadow-sm transition-transform ${
                value ? "translate-x-[18px]" : "translate-x-[2px]"
              }`}
            />
          </span>
          <span className="text-[13px] text-body group-hover:text-ink">Ricerca ibrida</span>
        </button>
        <button
          type="button"
          onClick={() => setAiuto((v) => !v)}
          aria-expanded={aiuto}
          aria-label="Cos'è la ricerca ibrida?"
          title="Unisce la ricerca testuale e quella per significato."
          className="flex h-8 w-8 items-center justify-center rounded-full text-mute transition hover:bg-canvas-soft-2 hover:text-ink"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
        </button>
      </div>
      {aiuto && (
        <p id={aiutoId} className="mt-1 max-w-sm text-center text-[12.5px] leading-relaxed text-mute">
          Alla ricerca testuale aggiunge i documenti vicini per significato,
          anche senza le parole esatte, e li ordina insieme. Codici ed estremi
          (F/3, Circ. 2/2016, D.P.R. 1142/1949) restano sempre sulla ricerca
          testuale. Le domande discorsive usano la ricerca ibrida da sole.
        </p>
      )}
    </div>
  );
}
