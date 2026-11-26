"use client";

import dynamic from "next/dynamic";
import { useCallback, useState } from "react";

/**
 * Normie (chat + filtri) si scarica SOLO quando serve: finche' l'utente non
 * tocca il pulsante, la pagina porta con se' soltanto questo bottone. Al
 * passaggio del mouse o al focus il codice viene precaricato, cosi' l'apertura
 * resta istantanea.
 */
const carica = () => import("./Normie").then((m) => m.Normie);
const Normie = dynamic(carica, { ssr: false, loading: () => <Pulsante caricamento /> });

function IconaBilancia({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M12 3v18M7 21h10M5 7h14M12 7 6 9m6-2 6 2" />
      <path d="M6 9l-2.5 5a2.5 2.5 0 0 0 5 0L6 9Zm12 0-2.5 5a2.5 2.5 0 0 0 5 0L18 9Z" />
    </svg>
  );
}

function Pulsante({ onClick, onPrefetch, caricamento }: { onClick?: () => void; onPrefetch?: () => void; caricamento?: boolean }) {
  return (
    <div className="fixed bottom-4 right-3 z-50 print:hidden sm:bottom-6 sm:right-6">
      <button
        type="button"
        onClick={onClick}
        onPointerEnter={onPrefetch}
        onFocus={onPrefetch}
        aria-label="Apri Normie, assistente normativa"
        aria-busy={caricamento}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-link text-white shadow-ds-lg transition-colors hover:bg-link-deep"
      >
        <IconaBilancia className={`h-6 w-6 ${caricamento ? "animate-pulse" : ""}`} />
      </button>
    </div>
  );
}

export function NormieLazy() {
  const [attivo, setAttivo] = useState(false);
  const precarica = useCallback(() => {
    void carica();
  }, []);
  if (!attivo) return <Pulsante onClick={() => setAttivo(true)} onPrefetch={precarica} />;
  return <Normie defaultOpen />;
}
