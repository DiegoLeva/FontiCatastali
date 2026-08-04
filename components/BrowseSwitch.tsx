"use client";

import { motion } from "framer-motion";
import { LibraryIcon, MapIcon } from "./icons";

export type BrowseMode = "cartelle" | "argomenti";

const OPZIONI: {
  key: BrowseMode;
  label: string;
  Icon: typeof MapIcon;
}[] = [
  { key: "cartelle", label: "Sfoglia per cartella", Icon: LibraryIcon },
  { key: "argomenti", label: "Sfoglia per argomenti", Icon: MapIcon },
];

/**
 * Due modi di leggere lo stesso archivio: per argomento (mappa) o per cartella
 * e anno (biblioteca). Rispondono a domande diverse, quindi restano entrambi.
 */
export function BrowseSwitch({
  mode,
  onChange,
}: {
  mode: BrowseMode;
  onChange: (m: BrowseMode) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Modo di consultazione"
      className="mb-6 flex gap-1 rounded-ds border border-hairline bg-canvas-soft p-1"
    >
      {OPZIONI.map(({ key, label, Icon }) => {
        const active = mode === key;
        return (
          <button
            key={key}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(key)}
            className={`relative flex flex-1 items-center justify-center gap-2 rounded-[6px] px-3 py-2 text-[13px] font-medium transition focus:outline-none focus-visible:shadow-focus ${
              active ? "text-ink" : "text-mute hover:text-body"
            }`}
          >
            {active && (
              <motion.span
                layoutId="browse-switch-pill"
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
                className="absolute inset-0 rounded-[6px] border border-hairline bg-canvas shadow-ds"
              />
            )}
            <Icon className="relative h-3.5 w-3.5" />
            <span className="relative truncate">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
