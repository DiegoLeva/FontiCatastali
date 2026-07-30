"use client";

import type { DecadeFacet } from "@/lib/types";
import { FilterIcon } from "./icons";

interface Props {
  decades: DecadeFacet[];
  active: string[];
  onToggle: (key: string) => void;
  onReset: () => void;
}

/** Barra filtri per decennio (faceted, multi-select). */
export function FilterBar({ decades, active, onToggle, onReset }: Props) {
  if (decades.length <= 1) return null;

  const chip = (on: boolean) =>
    `flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-medium tracking-[-0.01em] transition ${
      on
        ? "bg-ink text-canvas"
        : "border border-hairline bg-canvas text-body hover:border-hairline-strong hover:text-ink"
    }`;

  return (
    <div className="mb-4 flex items-center gap-2.5">
      <FilterIcon className="h-4 w-4 shrink-0 text-mute" />
      <div className="scrollbar-thin flex flex-1 items-center gap-2 overflow-x-auto pb-1">
        <button
          type="button"
          onClick={onReset}
          aria-pressed={active.length === 0}
          className={chip(active.length === 0).replace("gap-1.5", "")}
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
              className={chip(on)}
            >
              {d.label}
              <span
                className={`font-mono text-[11px] tabular-nums ${
                  on ? "text-canvas/70" : "text-mute"
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
