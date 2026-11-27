"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { caricaNovita, useSeguiti } from "@/lib/watchlist/client";

/**
 * Badge discreto nell'intestazione: compare solo se segui almeno un argomento
 * e il controllo automatico ha importato atti che lo riguardano dopo la tua
 * ultima visita a /aggiornamenti. Nessuna chiamata se non segui nulla.
 */
export function BadgeNovita() {
  const seguiti = useSeguiti();
  const [totale, setTotale] = useState(0);

  useEffect(() => {
    let vivo = true;
    if (!seguiti.length) {
      setTotale(0);
      return;
    }
    caricaNovita(seguiti).then((r) => {
      if (vivo) setTotale(r?.totale ?? 0);
    });
    return () => {
      vivo = false;
    };
  }, [seguiti]);

  if (!totale) return null;
  return (
    <Link
      href="/aggiornamenti#seguiti"
      aria-label={`Novità sui tuoi argomenti: ${totale} ${totale === 1 ? "nuovo atto" : "nuovi atti"}`}
      className="inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-medium text-link transition hover:bg-canvas-soft-2 focus:outline-none focus-visible:shadow-focus"
    >
      <span className="relative flex h-2 w-2" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-link opacity-40 motion-reduce:animate-none" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-link" />
      </span>
      <span className="hidden sm:inline">Novità sui tuoi argomenti</span>
      <span className="sm:hidden">Novità</span>
      <span className="font-mono text-[11px] tabular-nums">{totale}</span>
    </Link>
  );
}
