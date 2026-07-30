"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import type { FolderGroup } from "@/lib/types";
import { FileLeaf } from "./FileLeaf";
import { ChevronIcon, FolderIcon } from "./icons";

/**
 * Livello 2 (Ramo): cartella con badge conteggio, espandibile/collassabile.
 * Mount condizionale + fade-in CSS (chiusura immediata, apertura fluida).
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
    <div className="overflow-hidden rounded-ds border border-hairline bg-canvas shadow-ds">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-canvas-soft"
      >
        <motion.span
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="text-mute"
        >
          <ChevronIcon className="h-4 w-4" />
        </motion.span>

        <FolderIcon className="h-4 w-4 shrink-0 text-ink" />

        <span className="truncate text-[15px] font-medium tracking-[-0.01em] text-ink">
          {group.cartella}
        </span>

        <span className="ml-auto shrink-0 rounded-full border border-hairline bg-canvas-soft px-2.5 py-0.5 font-mono text-[11px] tabular-nums text-body">
          {group.count}
        </span>
      </button>

      {open && (
        <div id={panelId} className="animate-panel-in">
          <div className="space-y-1 border-t border-hairline p-2">
            {group.files.map((hit) => (
              <FileLeaf key={hit.id} hit={hit} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
