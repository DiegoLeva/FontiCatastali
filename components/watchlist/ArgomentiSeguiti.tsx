"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { caricaNovita, dataRiferimento, segnaVisita, smetti, useSeguiti, type RispostaNovita } from "@/lib/watchlist/client";

const dataBreve = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" });
};

/**
 * Sezione "I tuoi argomenti" di /aggiornamenti: per ogni argomento seguito,
 * i nuovi atti importati dal controllo automatico dopo l'ultima visita.
 */
export function ArgomentiSeguiti() {
  const seguiti = useSeguiti();
  const [dati, setDati] = useState<RispostaNovita | null>(null);
  const [caricamento, setCaricamento] = useState(false);

  useEffect(() => {
    if (!seguiti.length) {
      setDati(null);
      return;
    }
    let vivo = true;
    setCaricamento(true);
    caricaNovita(seguiti).then((r) => {
      if (!vivo) return;
      setDati(r);
      setCaricamento(false);
    });
    return () => {
      vivo = false;
    };
  }, [seguiti]);

  return (
    <section id="seguiti" className="scroll-mt-6 rounded-ds-lg border border-hairline bg-canvas p-5 shadow-ds" aria-labelledby="titolo-seguiti">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="titolo-seguiti" className="font-mono text-[11.5px] uppercase tracking-[0.14em] text-mute">
          I tuoi argomenti seguiti
        </h2>
        {dati && dati.totale > 0 && (
          <button onClick={segnaVisita} className="text-[12.5px] text-link underline underline-offset-4 hover:text-link-deep">
            Segna come viste
          </button>
        )}
      </div>

      {!seguiti.length ? (
        <p className="mt-3 text-[13.5px] leading-relaxed text-body">
          Non segui ancora nessun argomento. Dalla <Link href="/" className="text-link underline underline-offset-4">ricerca</Link> o dallo{" "}
          <Link href="/studio" className="text-link underline underline-offset-4">Studio Normativo</Link> premi «Segui l&apos;argomento» (es. volture, F/3,
          fotovoltaico, DOCFA, PREGEO): qui e nell&apos;intestazione vedrai i nuovi atti che il controllo del lunedì importa su quei temi. Gli
          argomenti restano salvati solo in questo browser.
        </p>
      ) : (
        <>
          <p className="mt-2 text-[12.5px] text-mute">
            Novità dal {dataBreve(dataRiferimento(seguiti))}
            {caricamento ? " · aggiornamento…" : ""}
          </p>
          <ul className="mt-3 space-y-3">
            {seguiti.map((s) => {
              const nov = dati?.argomenti.find((a) => a.argomento.toLowerCase() === s.argomento.toLowerCase());
              const atti = nov?.atti ?? [];
              return (
                <li key={s.argomento} className="rounded-ds border border-hairline px-3.5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/studio?argomento=${encodeURIComponent(s.argomento)}`} className="text-[14px] font-medium text-ink hover:text-link">
                      {s.argomento}
                    </Link>
                    <span className={`rounded-full px-2 py-px text-[11px] font-medium ${atti.length ? "bg-link-soft text-link-deep dark:bg-[rgba(0,112,243,0.18)] dark:text-[#9ecbff]" : "bg-canvas-soft-2 text-mute"}`}>
                      {atti.length ? `${atti.length} ${atti.length === 1 ? "nuovo atto" : "nuovi atti"}` : "nessuna novità"}
                    </span>
                    <button onClick={() => smetti(s.argomento)} className="ml-auto text-[12px] text-mute underline-offset-4 hover:text-ink hover:underline">
                      Smetti di seguire
                    </button>
                  </div>
                  {atti.length > 0 && (
                    <ul className="mt-2 space-y-1.5">
                      {atti.map((a) => (
                        <li key={a.id} className="text-[13px] leading-snug">
                          <Link href={`/documento/${a.id}?q=${encodeURIComponent(s.argomento)}`} className="text-body hover:text-link">
                            {a.titolo}
                          </Link>
                          <span className="text-mute"> · importato il {dataBreve(a.importatoIl)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
