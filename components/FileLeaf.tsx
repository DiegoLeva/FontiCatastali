"use client";

import type { FileHit } from "@/lib/types";
import { HighlightedSnippet } from "./HighlightedSnippet";
import { DocIcon, ExternalIcon } from "./icons";

/**
 * Livello 3 (Foglia): blocco-link che apre il PDF in una nuova scheda.
 * Sotto il nome file, snippet con keyword sempre visibile.
 */
export function FileLeaf({ hit }: { hit: FileHit }) {
  const title = hit.titolo && hit.titolo !== "s.n." ? hit.titolo : hit.nomeFile;

  return (
    <a
      href={hit.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group/leaf block rounded-ds border border-transparent p-3 transition
                 hover:border-hairline hover:bg-canvas-soft
                 focus-visible:border-link focus-visible:bg-canvas-soft focus-visible:outline-none"
    >
      <div className="flex items-start gap-3">
        <DocIcon className="mt-0.5 h-4 w-4 shrink-0 text-mute group-hover/leaf:text-link" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h4 className="truncate text-[13.5px] font-medium tracking-[-0.01em] text-ink group-hover/leaf:text-link">
              {title}
            </h4>
            {hit.anno !== "0000" && (
              <span className="shrink-0 rounded-full border border-hairline bg-canvas-soft px-1.5 py-0.5 font-mono text-[10.5px] tabular-nums text-mute">
                {hit.anno}
              </span>
            )}
            <ExternalIcon className="ml-auto h-3.5 w-3.5 shrink-0 text-mute opacity-0 transition group-hover/leaf:opacity-100" />
          </div>
          <div className="mt-1.5">
            <HighlightedSnippet html={hit.snippetHtml} />
          </div>
        </div>
      </div>
    </a>
  );
}
