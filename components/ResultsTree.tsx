"use client";

import { motion } from "framer-motion";
import type { SearchResponse } from "@/lib/types";
import { FolderNode } from "./FolderNode";
import { SearchIcon } from "./icons";

/**
 * Diagramma ad albero:
 *  - Radice (L1): la/e parola/e cercata/e + totale risultati
 *  - Rami   (L2): le cartelle con badge conteggio
 *  - Foglie (L3): i file con snippet (dentro FolderNode)
 */
export function ResultsTree({ data }: { data: SearchResponse }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="w-full"
    >
      {/* Radice */}
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-2 rounded-full bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white shadow-soft">
          <SearchIcon className="h-3.5 w-3.5" />
          {data.query}
        </span>
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          {data.total} risultati in {data.groups.length}{" "}
          {data.groups.length === 1 ? "cartella" : "cartelle"}
          <span className="mx-1.5 text-zinc-300 dark:text-zinc-600">·</span>
          <span className="tabular-nums">{data.tookMs} ms</span>
        </span>
      </div>

      {/* Connettore verticale + rami */}
      <div className="space-y-3 border-l border-dashed border-zinc-200 pl-4 dark:border-zinc-800 sm:pl-6">
        {data.groups.map((group, i) => (
          <FolderNode key={group.cartella} group={group} defaultOpen={i === 0} />
        ))}
      </div>
    </motion.section>
  );
}
