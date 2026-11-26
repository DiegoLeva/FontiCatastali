"use client";

import { useMemo, useState } from "react";
import type { FonteStudio } from "@/lib/studio/tipi";
import { RUOLI, annoBreve } from "./stile";

type Ordine = "cron-asc" | "cron-desc" | "rilevanza";
type Livello = "tutte" | "analizzata" | "menzione";

/**
 * Indice completo delle fonti trovate: filtrabile per tipologia, livello di
 * analisi e testo, ordinabile per anno o rilevanza. Ogni voce apre il drawer.
 */
export function IndiceFonti({
  fonti,
  attiva,
  onApri,
}: {
  fonti: FonteStudio[];
  attiva: number | null;
  onApri: (n: number, el: HTMLElement) => void;
}) {
  const [testo, setTesto] = useState("");
  const [tipo, setTipo] = useState<string>("");
  const [livello, setLivello] = useState<Livello>("tutte");
  const [ordine, setOrdine] = useState<Ordine>("cron-asc");

  const tipi = useMemo(() => {
    const c = new Map<string, number>();
    for (const f of fonti) c.set(f.tipo, (c.get(f.tipo) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [fonti]);

  const visibili = useMemo(() => {
    const q = testo
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .trim();
    const filtrate = fonti.filter((f) => {
      if (tipo && f.tipo !== tipo) return false;
      if (livello !== "tutte" && f.livello !== livello) return false;
      if (q && !`${f.titolo} ${f.anno} F${f.n}`.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").includes(q)) return false;
      return true;
    });
    const ord = [...filtrate];
    if (ordine === "cron-desc") ord.sort((a, b) => b.n - a.n);
    else if (ordine === "rilevanza") ord.sort((a, b) => b.punteggio - a.punteggio || a.n - b.n);
    else ord.sort((a, b) => a.n - b.n);
    return ord;
  }, [fonti, testo, tipo, livello, ordine]);

  const analizzate = fonti.filter((f) => f.livello === "analizzata").length;

  return (
    <div className="flex min-h-0 flex-col">
      <div className="space-y-2">
        <p className="font-mono text-[11px] text-mute">
          {fonti.length} fonti · {analizzate} analizzate · {fonti.length - analizzate} menzioni
        </p>
        <input
          type="search"
          value={testo}
          onChange={(e) => setTesto(e.target.value)}
          placeholder="Filtra per titolo, anno o F…"
          aria-label="Filtra le fonti"
          className="w-full rounded-ds border border-hairline bg-canvas px-3 py-2 text-base text-ink placeholder:text-mute focus:border-link focus:shadow-focus focus:outline-none sm:text-[13px]"
        />
        <div className="flex gap-2">
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            aria-label="Tipologia"
            className="min-w-0 flex-1 rounded-ds border border-hairline bg-canvas px-2 py-1.5 text-base text-ink focus:border-link focus:outline-none sm:text-[12.5px]"
          >
            <option value="">Tutte le tipologie</option>
            {tipi.map(([t, n]) => (
              <option key={t} value={t}>
                {t} ({n})
              </option>
            ))}
          </select>
          <select
            value={ordine}
            onChange={(e) => setOrdine(e.target.value as Ordine)}
            aria-label="Ordinamento"
            className="rounded-ds border border-hairline bg-canvas px-2 py-1.5 text-base text-ink focus:border-link focus:outline-none sm:text-[12.5px]"
          >
            <option value="cron-asc">Anno ↑</option>
            <option value="cron-desc">Anno ↓</option>
            <option value="rilevanza">Rilevanza</option>
          </select>
        </div>
        <div className="flex gap-1 rounded-ds border border-hairline bg-canvas-soft p-0.5" role="group" aria-label="Livello di analisi">
          {(
            [
              ["tutte", "Tutte"],
              ["analizzata", "Analizzate"],
              ["menzione", "Menzioni"],
            ] as Array<[Livello, string]>
          ).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setLivello(k)}
              aria-pressed={livello === k}
              className={`flex-1 rounded-[6px] px-2 py-1 text-[12px] font-medium transition ${
                livello === k ? "bg-canvas text-ink shadow-ds ring-1 ring-hairline" : "text-mute hover:text-ink"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <ul className="mt-3 space-y-1">
        {visibili.map((f) => (
          <li key={f.n}>
            <button
              onClick={(e) => onApri(f.n, e.currentTarget)}
              className={`group flex w-full items-start gap-2.5 rounded-md border px-2.5 py-2 text-left transition ${
                attiva === f.n ? "border-link bg-link-soft/40" : "border-transparent hover:border-hairline hover:bg-canvas-soft"
              }`}
            >
              <span
                className={`mt-0.5 shrink-0 rounded-[5px] px-1 py-px font-mono text-[10.5px] font-semibold ${
                  f.livello === "analizzata" ? "bg-link-soft text-link-deep dark:bg-[rgba(0,112,243,0.18)] dark:text-[#9ecbff]" : "bg-canvas-soft-2 text-mute"
                }`}
              >
                F{f.n}
              </span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 break-words text-[12.5px] leading-snug text-ink group-hover:text-link">{f.titolo}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-mute">
                  {f.nota && <span className={`h-1.5 w-1.5 rounded-full ${RUOLI[f.nota.ruolo].punto}`} aria-hidden />}
                  {annoBreve(f.anno)} · {f.tipo}
                </span>
              </span>
            </button>
          </li>
        ))}
        {visibili.length === 0 && <li className="px-2 py-4 text-center text-[12.5px] text-mute">Nessuna fonte con questi filtri.</li>}
      </ul>
    </div>
  );
}
