"use client";

import { useMemo, useState } from "react";
import type { Dossier, FonteStudio } from "@/lib/studio/tipi";
import { anniDossier, confrontaDate, ETICHETTE_STATO, nomeAtto } from "@/lib/studio/didattica";

/**
 * Confronto tra due date (0 neuroni): norme gia' emanate al primo anno e
 * norme intervenute fino al secondo, con i cambiamenti della timeline
 * nell'intervallo. Tutto calcolato sul dossier gia' generato.
 */
export function ConfrontoDate({ dossier, onApri }: { dossier: Dossier; onApri: (n: number, el: HTMLElement) => void }) {
  const anni = useMemo(() => anniDossier(dossier), [dossier]);
  const [annoA, setAnnoA] = useState(() => anni[Math.max(0, Math.floor((anni.length - 1) / 2))] ?? 0);
  const [annoB, setAnnoB] = useState(() => anni[anni.length - 1] ?? 0);
  const c = useMemo(() => (anni.length ? confrontaDate(dossier, annoA, annoB) : null), [dossier, anni.length, annoA, annoB]);

  if (anni.length < 2 || !c) {
    return <p className="rounded-ds border border-dashed border-hairline p-6 text-center text-[14px] text-mute">Servono fonti di almeno due anni diversi per un confronto tra date.</p>;
  }

  const Selettore = ({ valore, onChange, etichetta }: { valore: number; onChange: (v: number) => void; etichetta: string }) => (
    <label className="flex items-center gap-2 text-[13.5px] text-body">
      <span className="text-mute">{etichetta}</span>
      <select
        value={valore}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-9 rounded-ds border border-hairline bg-canvas px-2 font-mono text-[13.5px] text-ink shadow-ds focus:border-link focus:outline-none"
      >
        {anni.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
    </label>
  );

  const Voce = ({ f, nota }: { f: FonteStudio; nota?: string }) => (
    <li>
      <button
        onClick={(e) => onApri(f.n, e.currentTarget)}
        className="group flex w-full items-start gap-2 rounded-ds px-2 py-1.5 text-left transition hover:bg-canvas-soft"
      >
        <span className="mt-0.5 shrink-0 font-mono text-[11px] tabular-nums text-mute">{f.anno}</span>
        <span className="min-w-0 flex-1 text-[13.5px] leading-snug text-ink group-hover:text-link">
          {nomeAtto(f)}
          {nota && <span className="ml-1.5 text-[11.5px] text-[#9a4a07] dark:text-[#f5b86a]">{nota}</span>}
          {f.nota?.sintesi && <span className="mt-0.5 block text-[12.5px] leading-relaxed text-body">{f.nota.sintesi}</span>}
        </span>
        <span className="mt-0.5 shrink-0 font-mono text-[10.5px] text-mute">F{f.n}</span>
      </button>
    </li>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-ds border border-hairline bg-canvas-soft px-4 py-3">
        <Selettore valore={annoA} onChange={setAnnoA} etichetta="Situazione al" />
        <Selettore valore={annoB} onChange={setAnnoB} etichetta="confrontata con il" />
        <p className="text-[12.5px] text-mute">
          {c.totaleIntervenute} {c.totaleIntervenute === 1 ? "atto intervenuto" : "atti intervenuti"} tra il {c.annoA} e il {c.annoB}
          {c.intervenute.length > 0 && `: ${c.intervenute.map((g) => `${g.fonti.length} ${g.etichetta.toLowerCase()}`).join(", ")}`}.
        </p>
      </div>

      <div className="mt-5 grid gap-6 md:grid-cols-2">
        <section aria-labelledby="titolo-gia">
          <h3 id="titolo-gia" className="mb-2 font-mono text-[11.5px] uppercase tracking-[0.14em] text-mute">
            Già emanate al {c.annoA} ({c.giaEmanate.length})
          </h3>
          {c.giaEmanate.length ? (
            <ul className="divide-y divide-hairline rounded-ds border border-hairline bg-canvas">
              {c.giaEmanate.map(({ fonte, superataNellIntervallo }) => (
                <Voce
                  key={fonte.n}
                  f={fonte}
                  nota={superataNellIntervallo ? `superata entro il ${c.annoB}` : fonte.nota?.stato === "superato" ? `oggi ${ETICHETTE_STATO.superato.toLowerCase()}` : undefined}
                />
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-mute">Nessuna fonte del dossier entro il {c.annoA}.</p>
          )}
        </section>

        <section aria-labelledby="titolo-dopo">
          <h3 id="titolo-dopo" className="mb-2 font-mono text-[11.5px] uppercase tracking-[0.14em] text-mute">
            Intervenute dopo il {c.annoA}, fino al {c.annoB}
          </h3>
          {c.intervenute.length ? (
            <div className="space-y-4">
              {c.intervenute.map((g) => (
                <div key={g.ruolo}>
                  <p className="mb-1 text-[12.5px] font-medium text-ink">{g.etichetta}</p>
                  <ul className="divide-y divide-hairline rounded-ds border border-hairline bg-canvas">
                    {g.fonti.map((f) => (
                      <Voce key={f.n} f={f} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-mute">Nessun atto del dossier nell&apos;intervallo.</p>
          )}
        </section>
      </div>

      {c.cambiamenti.length > 0 && (
        <section className="mt-6" aria-labelledby="titolo-cambiamenti">
          <h3 id="titolo-cambiamenti" className="mb-2 font-mono text-[11.5px] uppercase tracking-[0.14em] text-mute">
            Che cosa è cambiato tra il {c.annoA} e il {c.annoB}
          </h3>
          <ol className="space-y-2 border-l border-hairline pl-4">
            {c.cambiamenti.map((v, i) => (
              <li key={`${v.n}-${i}`} className="text-[13.5px] leading-relaxed text-body">
                <span className="font-mono text-[11.5px] text-mute">{v.anno}</span> · {v.cambiamento.replace(/\[\s*F\s*\d+[^\]]*\]/g, "").trim()}{" "}
                <span className="font-mono text-[10.5px] text-mute">[F{v.n}]</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
