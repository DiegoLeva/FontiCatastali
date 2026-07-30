"use client";

import type { SearchResponse } from "@/lib/types";
import { FolderNode } from "./FolderNode";
import { SearchIcon } from "./icons";

/**
 * Diagramma ad albero: L1 radice (query) -> L2 cartelle -> L3 file.
 */
export function ResultsTree({ data }: { data: SearchResponse }) {
  return (
    <section className="w-full">
      {/* Radice */}
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-[13px] font-medium tracking-[-0.01em] text-canvas">
          <SearchIcon className="h-3.5 w-3.5" />
          {data.query}
        </span>
        <span className="font-mono text-[12px] text-mute">
          {data.total} risultati · {data.groups.length}{" "}
          {data.groups.length === 1 ? "cartella" : "cartelle"} · {data.tookMs}ms
        </span>
      </div>

      {/* Connettore + rami */}
      <div className="space-y-3 border-l border-hairline pl-4 sm:pl-6">
        {data.groups.map((group, i) => (
          <FolderNode key={group.cartella} group={group} defaultOpen={i === 0} />
        ))}
      </div>
    </section>
  );
}
