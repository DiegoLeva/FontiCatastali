"use client";

import type { FileHit } from "@/lib/types";
import { HighlightedSnippet } from "./HighlightedSnippet";
import { DocIcon, ExternalIcon } from "./icons";

/**
 * Livello 3 (Foglia): l'intero blocco e' un link che apre il PDF in una nuova
 * scheda. Sotto il nome file e' SEMPRE visibile lo snippet con la keyword.
 */
export function FileLeaf({ hit }: { hit: FileHit }) {
  const title = hit.titolo && hit.titolo !== "s.n." ? hit.titolo : hit.nomeFile;

  return (
    <a
      href={hit.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group/leaf block rounded-xl border border-transparent p-3 transition
                 hover:border-zinc-200 hover:bg-zinc-50
                 focus-visible:border-brand-400 focus-visible:bg-zinc-50 focus-visible:outline-none
                 dark:hover:border-zinc-800 dark:hover:bg-zinc-800/40 dark:focus-visible:bg-zinc-800/40"
    >
      <div className="flex items-start gap-3">
        <DocIcon className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400 group-hover/leaf:text-brand-600" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="truncate text-sm font-semibold text-zinc-800 group-hover/leaf:text-brand-700 dark:text-zinc-100 dark:group-hover/leaf:text-brand-400">
              {title}
            </h4>
            {hit.anno !== "0000" && (
              <span className="shrink-0 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                {hit.anno}
              </span>
            )}
            <ExternalIcon className="ml-auto h-3.5 w-3.5 shrink-0 text-zinc-300 opacity-0 transition group-hover/leaf:opacity-100 dark:text-zinc-600" />
          </div>
          <div className="mt-1.5">
            <HighlightedSnippet html={hit.snippetHtml} />
          </div>
        </div>
      </div>
    </a>
  );
}
