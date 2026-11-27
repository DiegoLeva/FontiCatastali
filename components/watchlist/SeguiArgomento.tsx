"use client";

import { segui, smetti, useSeguiti } from "@/lib/watchlist/client";

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim();

function Campanella({ piena, className }: { piena: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill={piena ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

/**
 * "Segui questo argomento": il controllo automatico del lunedi' segnalera'
 * i nuovi atti che lo riguardano (badge nell'intestazione e /aggiornamenti).
 */
export function SeguiArgomento({ argomento, compatto = false }: { argomento: string; compatto?: boolean }) {
  const seguiti = useSeguiti();
  const a = argomento.replace(/\s+/g, " ").trim();
  if (a.length < 2) return null;
  const attivo = seguiti.some((s) => norm(s.argomento) === norm(a));
  return (
    <button
      type="button"
      onClick={() => (attivo ? smetti(a) : segui(a))}
      aria-pressed={attivo}
      title={attivo ? "Smetti di seguire: niente più avvisi sui nuovi atti" : "Ricevi un avviso quando escono nuovi atti su questo argomento"}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition focus:outline-none focus-visible:shadow-focus ${
        attivo
          ? "border-link/40 bg-link-soft text-link-deep dark:bg-[rgba(0,112,243,0.18)] dark:text-[#9ecbff]"
          : "border-hairline bg-canvas text-body hover:border-hairline-strong hover:text-ink"
      }`}
    >
      <Campanella piena={attivo} className="h-3.5 w-3.5" />
      {attivo ? (compatto ? "Seguito" : "Argomento seguito") : compatto ? "Segui" : "Segui l'argomento"}
    </button>
  );
}
