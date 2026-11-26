"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { StatoAggiornamentiBreve } from "@/lib/aggiornamenti/tipi";

function dataBreve(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("it-IT", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Riga di stato dell'archivio in fondo alla home: quanti documenti, quando e'
 * stato fatto l'ultimo controllo automatico delle fonti e con che esito.
 * Si carica dopo il resto della pagina e, se l'endpoint non risponde, non
 * mostra nulla: e' un'informazione accessoria, mai un punto di rottura.
 */
export function ArchivioStato() {
  const [stato, setStato] = useState<StatoAggiornamentiBreve | null>(null);

  useEffect(() => {
    let vivo = true;
    const avvia = () =>
      fetch("/api/aggiornamenti/stato?breve=1")
        .then((r) => (r.ok ? r.json() : null))
        .then((j: StatoAggiornamentiBreve | null) => vivo && j && setStato(j))
        .catch(() => undefined);
    // Dopo il caricamento: non compete con la ricerca per la rete.
    const t = window.setTimeout(avvia, 1200);
    return () => {
      vivo = false;
      window.clearTimeout(t);
    };
  }, []);

  if (!stato) return null;

  const controllo = dataBreve(stato.ultimoControllo);
  const esitoKo = stato.ultimoEsito === "errore" || stato.ultimoEsito === "parziale";

  return (
    <p className="mx-auto mt-16 flex max-w-3xl flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center font-mono text-[11.5px] text-mute">
      {stato.documenti > 0 && <span>{stato.documenti.toLocaleString("it-IT")} documenti</span>}
      {controllo && (
        <>
          <span aria-hidden>·</span>
          <span>
            ultimo controllo fonti {controllo}
            {esitoKo && (
              <span className="text-[#c50000] dark:text-[#ff6666]"> (con avvisi)</span>
            )}
          </span>
        </>
      )}
      {stato.importatiUltimi30gg > 0 && (
        <>
          <span aria-hidden>·</span>
          <span>
            {stato.importatiUltimi30gg}{" "}
            {stato.importatiUltimi30gg === 1 ? "nuovo atto" : "nuovi atti"} nel mese
          </span>
        </>
      )}
      <span aria-hidden>·</span>
      <Link
        href="/aggiornamenti"
        className="underline decoration-hairline-strong underline-offset-4 transition hover:text-ink"
      >
        stato aggiornamenti
      </Link>
    </p>
  );
}
