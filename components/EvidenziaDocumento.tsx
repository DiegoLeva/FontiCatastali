"use client";

import { useEffect, useState } from "react";
import { espandiArgomento } from "@/lib/studio/espansione";
import { ChevronIcon } from "./icons";

/**
 * Evidenzia nel testo del lettore i termini dell'argomento (?q=...) e offre
 * la navigazione tra le occorrenze. Lavora sui nodi di testo gia' resi dal
 * server: il testo integrale non viene serializzato una seconda volta.
 */
export function EvidenziaDocumento({ contenitoreId }: { contenitoreId: string }) {
  const [totale, setTotale] = useState(0);
  const [corrente, setCorrente] = useState(-1);
  const [termine, setTermine] = useState("");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q")?.trim();
    const root = document.getElementById(contenitoreId);
    if (!q || !root) return;
    setTermine(q);
    let re: RegExp;
    try {
      re = new RegExp(espandiArgomento(q).concetti.map((c) => `(?:${c.regex})`).join("|"), "giu");
    } catch {
      return; // browser senza lookbehind: niente evidenziazione
    }
    const nodi: Text[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) nodi.push(walker.currentNode as Text);
    let n = 0;
    for (const nodo of nodi) {
      const testo = nodo.nodeValue ?? "";
      re.lastIndex = 0;
      if (!re.test(testo)) continue;
      re.lastIndex = 0;
      const frammento = document.createDocumentFragment();
      let ultimo = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(testo))) {
        if (!m[0]) {
          re.lastIndex++;
          continue;
        }
        if (m.index > ultimo) frammento.append(testo.slice(ultimo, m.index));
        const mark = document.createElement("mark");
        mark.textContent = m[0];
        mark.dataset.occorrenza = String(n++);
        frammento.append(mark);
        ultimo = m.index + m[0].length;
      }
      if (ultimo < testo.length) frammento.append(testo.slice(ultimo));
      nodo.replaceWith(frammento);
      if (n > 2000) break;
    }
    setTotale(n);
    if (n > 0) setCorrente(0);
  }, [contenitoreId]);

  useEffect(() => {
    if (corrente < 0) return;
    const marks = document.querySelectorAll<HTMLElement>(`#${contenitoreId} mark[data-occorrenza]`);
    marks.forEach((m) => m.classList.remove("ring-2", "ring-link"));
    const el = marks[corrente];
    if (el) {
      el.classList.add("ring-2", "ring-link");
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [corrente, contenitoreId]);

  if (!termine) return null;
  return (
    <div className="sticky top-2 z-20 mx-auto mb-4 flex max-w-3xl items-center gap-2 rounded-full border border-hairline bg-canvas/95 px-3 py-1.5 text-[12.5px] shadow-ds backdrop-blur print:hidden">
      <span className="min-w-0 flex-1 truncate text-body">
        “{termine}”: {totale ? `${corrente + 1} di ${totale} occorrenze` : "nessuna occorrenza nel testo"}
      </span>
      {totale > 0 && (
        <>
          <button onClick={() => setCorrente((c) => (c - 1 + totale) % totale)} aria-label="Occorrenza precedente" className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-canvas-soft-2">
            <ChevronIcon className="h-3.5 w-3.5 rotate-180" />
          </button>
          <button onClick={() => setCorrente((c) => (c + 1) % totale)} aria-label="Occorrenza successiva" className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-canvas-soft-2">
            <ChevronIcon className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </div>
  );
}
