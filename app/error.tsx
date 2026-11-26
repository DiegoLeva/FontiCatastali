"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Pagina di errore dell'applicazione: un guasto in un componente non lascia
 * piu' lo schermo bianco ma un messaggio con le due vie d'uscita.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] errore non gestito:", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center px-6 text-center">
      <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-mute">
        Errore
      </p>
      <h1 className="mt-3 text-[26px] font-semibold tracking-display-sm text-ink">
        Qualcosa non ha funzionato
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-body">
        La pagina ha incontrato un problema imprevisto. Puoi riprovare oppure
        tornare alla ricerca: i tuoi dati non sono andati persi.
      </p>
      <div className="mt-6 flex gap-3">
        <button
          onClick={reset}
          className="rounded-ds bg-ink px-4 py-2 text-[14px] font-medium text-canvas transition hover:opacity-90"
        >
          Riprova
        </button>
        <Link
          href="/"
          className="rounded-ds border border-hairline bg-canvas px-4 py-2 text-[14px] font-medium text-ink transition hover:bg-canvas-soft"
        >
          Torna alla ricerca
        </Link>
      </div>
      {error.digest && (
        <p className="mt-6 font-mono text-[11px] text-mute">rif. {error.digest}</p>
      )}
    </main>
  );
}
