"use client";

import { useMemo, useState } from "react";
import type { FonteStudio, RuoloFonte, VoceTimeline } from "@/lib/studio/tipi";
import { ChipCitazione } from "./testo";
import { RUOLI, STATI, annoBreve } from "./stile";

/**
 * Timeline interattiva: anno -> norma -> cambiamento introdotto. Costruita
 * dalle note delle fonti analizzate (mai dal testo generato), quindi ogni voce
 * e' ancorata a un documento del database. Le menzioni marginali di ciascun
 * anno restano richiamabili senza appesantire la lettura.
 */
export function Timeline({
  voci,
  fonti,
  onApri,
}: {
  voci: VoceTimeline[];
  fonti: Map<number, FonteStudio>;
  onApri: (n: number, el: HTMLElement) => void;
}) {
  const [filtro, setFiltro] = useState<Set<RuoloFonte>>(new Set());
  const [aperti, setAperti] = useState<Set<string>>(new Set());

  const ruoliPresenti = useMemo(() => {
    const conta = new Map<RuoloFonte, number>();
    for (const v of voci) conta.set(v.ruolo, (conta.get(v.ruolo) ?? 0) + 1);
    return [...conta.entries()].sort((a, b) => b[1] - a[1]);
  }, [voci]);

  const menzioniPerAnno = useMemo(() => {
    const m = new Map<string, FonteStudio[]>();
    for (const f of fonti.values()) {
      if (f.livello !== "menzione") continue;
      const lista = m.get(f.anno) ?? [];
      lista.push(f);
      m.set(f.anno, lista);
    }
    return m;
  }, [fonti]);

  const anni = useMemo(() => {
    const filtrate = voci.filter((v) => filtro.size === 0 || filtro.has(v.ruolo));
    const perAnno = new Map<string, VoceTimeline[]>();
    for (const v of filtrate) {
      const lista = perAnno.get(v.anno) ?? [];
      lista.push(v);
      perAnno.set(v.anno, lista);
    }
    return [...perAnno.entries()].sort(([a], [b]) => (a === "0000" ? 1 : b === "0000" ? -1 : a.localeCompare(b)));
  }, [voci, filtro]);

  if (voci.length === 0) {
    return (
      <p className="rounded-ds border border-dashed border-hairline p-5 text-center text-[13px] text-mute">
        La timeline si compone durante l&apos;analisi delle fonti…
      </p>
    );
  }

  const commuta = (r: RuoloFonte) =>
    setFiltro((s) => {
      const n = new Set(s);
      if (n.has(r)) n.delete(r);
      else n.add(r);
      return n;
    });

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1.5 print:hidden" role="group" aria-label="Filtra per ruolo">
        {ruoliPresenti.map(([r, n]) => {
          const on = filtro.has(r);
          return (
            <button
              key={r}
              onClick={() => commuta(r)}
              aria-pressed={on}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium transition ${
                on ? "border-ink bg-ink text-canvas" : "border-hairline bg-canvas text-body hover:border-hairline-strong"
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${RUOLI[r].punto}`} aria-hidden />
              {RUOLI[r].label}
              <span className={`font-mono text-[10.5px] ${on ? "text-canvas/70" : "text-mute"}`}>{n}</span>
            </button>
          );
        })}
        {filtro.size > 0 && (
          <button onClick={() => setFiltro(new Set())} className="rounded-full px-2.5 py-1 text-[12px] text-mute underline underline-offset-4 hover:text-ink">
            Tutti
          </button>
        )}
      </div>

      <ol className="relative border-l border-hairline-strong pl-0">
        {anni.map(([anno, lista]) => {
          const menzioni = menzioniPerAnno.get(anno) ?? [];
          const aperto = aperti.has(anno);
          return (
            <li key={anno} className="relative mb-5 pl-5 last:mb-0 sm:pl-6">
              <span className="absolute -left-[5px] top-1.5 h-[9px] w-[9px] rounded-full border-2 border-canvas bg-ink" aria-hidden />
              <p className="font-mono text-[13px] font-semibold tabular-nums text-ink">{annoBreve(anno)}</p>
              <ul className="mt-2 space-y-2.5">
                {lista.map((v) => {
                  const f = fonti.get(v.n);
                  return (
                    <li key={v.n} className="rounded-ds border border-hairline bg-canvas p-3 shadow-ds">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${RUOLI[v.ruolo].punto}`} aria-hidden />
                        <ChipCitazione n={v.n} fonte={f} onApri={onApri} />
                        <span className="text-[11.5px] text-mute">{f?.tipo}</span>
                        <span className={`rounded-full border px-1.5 py-px text-[10.5px] font-medium ${RUOLI[v.ruolo].badge}`}>{RUOLI[v.ruolo].label}</span>
                        {v.stato === "superato" && (
                          <span className={`rounded-full border px-1.5 py-px text-[10.5px] font-medium ${STATI.superato.badge}`}>{STATI.superato.label}</span>
                        )}
                      </div>
                      <button
                        onClick={(e) => onApri(v.n, e.currentTarget)}
                        className="mt-1.5 block text-left text-[13.5px] font-medium leading-snug text-ink hover:text-link"
                      >
                        {f?.titolo}
                      </button>
                      {v.cambiamento && <p className="mt-1 text-[13px] leading-relaxed text-body">{v.cambiamento}</p>}
                    </li>
                  );
                })}
              </ul>
              {menzioni.length > 0 && filtro.size === 0 && (
                <div className="mt-2 print:hidden">
                  <button
                    onClick={() =>
                      setAperti((s) => {
                        const n = new Set(s);
                        if (n.has(anno)) n.delete(anno);
                        else n.add(anno);
                        return n;
                      })
                    }
                    aria-expanded={aperto}
                    className="text-[12px] text-mute underline decoration-hairline-strong underline-offset-4 hover:text-ink"
                  >
                    {aperto ? "Nascondi" : "+"} {menzioni.length} {menzioni.length === 1 ? "menzione marginale" : "menzioni marginali"}
                  </button>
                  {aperto && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {menzioni.map((m) => (
                        <ChipCitazione key={m.n} n={m.n} fonte={m} onApri={onApri} />
                      ))}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
