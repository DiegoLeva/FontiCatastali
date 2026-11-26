"use client";

import type { FaseStudio } from "@/lib/studio/tipi";
import { SpinnerIcon } from "@/components/icons";

export const FASI: Array<{ id: FaseStudio; label: string }> = [
  { id: "espansione", label: "Espansione argomento" },
  { id: "ricerca", label: "Ricerca nel database" },
  { id: "estratti", label: "Lettura dei testi" },
  { id: "analisi", label: "Ricostruzione cronologica" },
  { id: "stesura", label: "Stesura dossier" },
  { id: "verifica", label: "Verifiche" },
];

export interface StatoFase {
  messaggio: string;
  progresso?: number;
}

/** Avanzamento a fasi con i messaggi reali del server. */
export function Progresso({
  fasi,
  corrente,
  concluso,
}: {
  fasi: Partial<Record<FaseStudio, StatoFase>>;
  corrente: FaseStudio | null;
  concluso: boolean;
}) {
  const indiceCorrente = corrente ? FASI.findIndex((f) => f.id === corrente) : -1;
  const ultimo = corrente ? fasi[corrente] : undefined;

  return (
    <div className="rounded-ds-lg border border-hairline bg-canvas p-4 shadow-ds print:hidden" aria-live="polite">
      <ol className="grid grid-cols-3 gap-x-2 gap-y-2.5 sm:grid-cols-6">
        {FASI.map((f, i) => {
          const fatta = concluso || i < indiceCorrente;
          const attiva = !concluso && i === indiceCorrente;
          return (
            <li key={f.id} className="flex min-w-0 items-center gap-2">
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold ${
                  fatta
                    ? "border-ink bg-ink text-canvas"
                    : attiva
                      ? "border-link text-link"
                      : "border-hairline text-mute"
                }`}
                aria-hidden
              >
                {fatta ? "✓" : attiva ? <SpinnerIcon className="h-3 w-3" /> : i + 1}
              </span>
              <span className={`truncate text-[12px] ${attiva ? "font-medium text-ink" : fatta ? "text-body" : "text-mute"}`}>{f.label}</span>
            </li>
          );
        })}
      </ol>
      {!concluso && ultimo && (
        <div className="mt-3 border-t border-hairline pt-3">
          <p className="text-[13px] text-body">{ultimo.messaggio}</p>
          {typeof ultimo.progresso === "number" && (
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-canvas-soft-2">
              <div className="h-full rounded-full bg-link transition-[width] duration-300" style={{ width: `${Math.round(ultimo.progresso * 100)}%` }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
