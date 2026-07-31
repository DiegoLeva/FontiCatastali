"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type {
  CatalogCategory,
  CatalogResponse,
  CatalogYear,
} from "@/lib/types";
import { ResultsSkeleton } from "./Skeletons";
import { ChevronIcon, FolderIcon, DocIcon, ExternalIcon } from "./icons";

/* ---- Livello 3: documento (foglia) ---- */
function DocLeaf({
  titolo,
  anno,
  url,
  nomeFile,
}: {
  titolo: string;
  anno: string;
  url: string;
  nomeFile: string;
}) {
  const label = titolo && titolo !== "s.n." ? titolo : nomeFile;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="group/leaf flex items-center gap-2.5 rounded-md border border-transparent px-3 py-2 transition hover:border-hairline hover:bg-canvas-soft"
    >
      <DocIcon className="h-3.5 w-3.5 shrink-0 text-mute group-hover/leaf:text-link" />
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink group-hover/leaf:text-link">
        {label}
      </span>
      {anno !== "0000" && (
        <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-mute">
          {anno}
        </span>
      )}
      <ExternalIcon className="h-3 w-3 shrink-0 text-mute opacity-0 transition group-hover/leaf:opacity-100" />
    </a>
  );
}

/* ---- Livello 2: anno ---- */
function YearNode({ year }: { year: CatalogYear }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-canvas-soft"
      >
        <motion.span
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ duration: 0.18 }}
          className="text-mute"
        >
          <ChevronIcon className="h-3.5 w-3.5" />
        </motion.span>
        <span className="font-mono text-[13px] font-medium tabular-nums text-ink">
          {year.anno === "0000" ? "Senza data" : year.anno}
        </span>
        <span className="ml-auto font-mono text-[11px] tabular-nums text-mute">
          {year.count}
        </span>
      </button>
      {open && (
        <div className="animate-panel-in ml-2 space-y-0.5 border-l border-hairline pl-2">
          {year.docs.map((d) => (
            <DocLeaf key={d.id} {...d} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---- Livello 1: categoria ---- */
function CategoryNode({ cat }: { cat: CatalogCategory }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-ds border border-hairline bg-canvas shadow-ds">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-canvas-soft"
      >
        <motion.span
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ duration: 0.2 }}
          className="text-mute"
        >
          <ChevronIcon className="h-4 w-4" />
        </motion.span>
        <FolderIcon className="h-4 w-4 shrink-0 text-ink" />
        <span className="truncate text-[15px] font-medium tracking-[-0.01em] text-ink">
          {cat.cartella}
        </span>
        <span className="ml-auto shrink-0 rounded-full border border-hairline bg-canvas-soft px-2.5 py-0.5 font-mono text-[11px] tabular-nums text-body">
          {cat.count}
        </span>
      </button>
      {open && (
        <div className="animate-panel-in space-y-0.5 border-t border-hairline p-2">
          {cat.anni.map((y) => (
            <YearNode key={y.anno} year={y} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---- Albero completo ---- */
export function BrowseTree() {
  const [data, setData] = useState<CatalogResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");

  useEffect(() => {
    let alive = true;
    fetch("/api/catalog")
      .then((r) => r.json())
      .then((j: CatalogResponse) => {
        if (!alive) return;
        if (j.error) throw new Error(j.error);
        setData(j);
        setStatus("done");
      })
      .catch(() => alive && setStatus("error"));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section className="w-full">
      <div className="mb-4 flex items-baseline gap-3">
        <h2 className="font-mono text-[12px] uppercase tracking-[0.14em] text-mute">
          Sfoglia la normativa
        </h2>
        {data && (
          <span className="font-mono text-[12px] text-mute">
            {data.total} documenti · {data.categorie.length} categorie
          </span>
        )}
      </div>

      {status === "loading" && <ResultsSkeleton />}
      {status === "error" && (
        <div className="rounded-ds border border-dashed border-hairline p-6 text-center text-body">
          Impossibile caricare il catalogo.
        </div>
      )}
      {status === "done" && data && (
        <div className="space-y-3">
          {data.categorie.map((c) => (
            <CategoryNode key={c.cartella} cat={c} />
          ))}
        </div>
      )}
    </section>
  );
}
