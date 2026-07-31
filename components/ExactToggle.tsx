"use client";

interface Props {
  value: boolean;
  onChange: (v: boolean) => void;
}

/** Switch "Ricerca esatta": match letterale della stringa (spazi inclusi). */
export function ExactToggle({ value, onChange }: Props) {
  return (
    <div className="mt-3 flex items-center justify-center gap-2.5">
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full border transition-colors ${
          value
            ? "border-ink bg-ink"
            : "border-hairline bg-canvas-soft-2"
        }`}
      >
        <span
          className={`inline-block h-[16px] w-[16px] rounded-full bg-canvas shadow-sm transition-transform ${
            value ? "translate-x-[18px]" : "translate-x-[2px]"
          }`}
        />
      </button>
      <span className="text-[13px] text-body">
        Ricerca esatta
      </span>
      <span
        className="cursor-help text-mute"
        title="Cerca la stringa esatta così com'è scritta (spazi e caratteri inclusi). Se non c'è una corrispondenza precisa, nessun risultato."
        aria-hidden
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 16v-4M12 8h.01" />
        </svg>
      </span>
    </div>
  );
}
