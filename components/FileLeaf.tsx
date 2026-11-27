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
          <div className="flex items-start gap-2">
            {/* Due righe e a capo sulle parole lunghe: su smartphone un titolo
                troncato a una riga non lascia capire di che atto si tratta. */}
            <h4 className="line-clamp-2 min-w-0 break-words text-[13.5px] font-medium leading-snug tracking-[-0.01em] text-ink group-hover/leaf:text-link">
              {title}
            </h4>
            {hit.perSignificato && (
              <span
                title="Trovato dalla ricerca per significato: il testo non contiene per forza le parole cercate"
                className="mt-px shrink-0 rounded-full border border-link/30 bg-link-soft px-1.5 py-0.5 text-[10.5px] font-medium text-link-deep dark:border-link/40 dark:bg-[rgba(0,112,243,0.18)] dark:text-[#9ecbff]"
              >
                per significato
              </span>
            )}
            {hit.anno !== "0000" && (
              <span className="mt-px shrink-0 rounded-full border border-hairline bg-canvas-soft px-1.5 py-0.5 font-mono text-[10.5px] tabular-nums text-mute">
                {hit.anno}
              </span>
            )}
            <ExternalIcon className="ml-auto mt-0.5 h-3.5 w-3.5 shrink-0 text-mute opacity-0 transition group-hover/leaf:opacity-100" />
          </div>
          <div className="mt-1.5">
            <HighlightedSnippet html={hit.snippetHtml} />
          </div>
        </div>
      </div>
    </a>
  );
}
