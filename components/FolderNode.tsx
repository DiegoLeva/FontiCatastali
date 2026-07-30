"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import type { FolderGroup } from "@/lib/types";
import { FileLeaf } from "./FileLeaf";
import { ChevronIcon, FolderIcon } from "./icons";

/**
 * Livello 2 (Ramo): cartella con badge conteggio, espandibile/collassabile.
 *
 * NB: l'apertura/chiusura anima l'ALTEZZA (auto <-> 0) su un contenuto SEMPRE
 * montato (clippato quando chiuso). Evita di dipendere dall'`exit` di
 * AnimatePresence, che con React StrictMode puo' non completarsi lasciando i
 * nodi "bloccati". Cosi' l'animazione e' fluida e affidabile in dev e prod.
 */
export function FolderNode({
  group,
  defaultOpen = false,
}: {
  group: FolderGroup;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = `folder-${group.cartella.replace(/\W+/g, "-")}`;

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-soft dark:border-zinc-800 dark:bg-zinc-900">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
      >
        <motion.span
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="text-zinc-400"
        >
          <ChevronIcon className="h-4 w-4" />
        </motion.span>

        <FolderIcon className="h-5 w-5 shrink-0 text-brand-600" />

        <span className="truncate font-semibold text-zinc-800 dark:text-zinc-100">
          {group.cartella}
        </span>

        <span className="ml-auto shrink-0 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold tabular-nums text-brand-700 dark:bg-brand-950/60 dark:text-brand-300">
          {group.count} {group.count === 1 ? "documento" : "documenti"}
        </span>
      </button>

      {/* Mount condizionale + fade-in CSS: apertura fluida, chiusura immediata
          ("snappy"), DOM leggero (solo le cartelle aperte montano i file).
          Affidabile in dev e prod (nessun exit di AnimatePresence). */}
      {open && (
        <div id={panelId} className="animate-panel-in">
          <div className="space-y-1 border-t border-zinc-100 p-2 dark:border-zinc-800">
            {group.files.map((hit) => (
              <FileLeaf key={hit.id} hit={hit} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
