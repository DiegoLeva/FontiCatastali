"use client";

import type { DecadeFacet } from "@/lib/types";
import { FilterIcon } from "./icons";

interface Props {
  decades: DecadeFacet[];
  active: string[];
  onToggle: (key: string) => void;
  onReset: () => void;
}

/**
 * Barra filtri per decennio (faceted). Multi-select: nessuna selezione = tutti.
 * Compatta e scrollabile orizzontalmente su mobile.
 */
export function FilterBar({ decades, active, onToggle, onReset }: Props) {
  if (decades.length <= 1) return null;

  return (
    <div className="mb-4 flex items-center gap-2">
      <FilterIcon className="h-4 w-4 shrink-0 text-zinc-400" />
      <div className="scrollbar-thin flex flex-1 items-center gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={onReset}
          aria-pressed={active.length === 0}
          className={`shrink-0 rounded-full px-3 py-1 text-sm font-medium transition ${
            active.length === 0
              ? "bg-brand-600 text-white shadow-soft"
              : "border border-zinc-200 bg-white text-zinc-600 hover:border-brand-300 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
          }`}
        >
          Tutti
        </button>

        {decades.map((d) => {
          const on = active.includes(d.key);
          return (
            <button
              key={d.key}
              type="button"
              onClick={() => onToggle(d.key)}
              aria-pressed={on}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition ${
                on
                  ? "bg-brand-600 text-white shadow-soft"
                  : "border border-zinc-200 bg-white text-zinc-600 hover:border-brand-300 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
              }`}
            >
              {d.label}
              <span
                className={`rounded-full px-1.5 text-xs tabular-nums ${
                  on
                    ? "bg-white/20"
                    : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                }`}
              >
                {d.count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
