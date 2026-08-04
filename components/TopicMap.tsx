"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import type {
  CatalogDoc,
  TopicDocsResponse,
  TopicNode,
  TopicsResponse,
} from "@/lib/types";
import { ResultsSkeleton } from "./Skeletons";
import {
  ArrowLeftIcon,
  ChevronIcon,
  DocIcon,
  ExternalIcon,
  SpinnerIcon,
} from "./icons";

/* ========================================================================== */
/* Documenti di un nodo (caricati su richiesta)                               */
/* ========================================================================== */

function DocRow({ doc }: { doc: CatalogDoc }) {
  const label = doc.titolo && doc.titolo !== "s.n." ? doc.titolo : doc.nomeFile;
  return (
    <a
      href={doc.url}
      target="_blank"
      rel="noopener noreferrer"
      className="group/doc flex items-center gap-2.5 rounded-md border border-transparent px-3 py-2 transition hover:border-hairline hover:bg-canvas-soft"
    >
      <DocIcon className="h-3.5 w-3.5 shrink-0 text-mute group-hover/doc:text-link" />
      <span className="min-w-0 flex-1 truncate text-[13px] text-ink group-hover/doc:text-link">
        {label}
      </span>
      {doc.anno !== "0000" && (
        <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-mute">
          {doc.anno}
        </span>
      )}
      <ExternalIcon className="h-3 w-3 shrink-0 text-mute opacity-0 transition group-hover/doc:opacity-100" />
    </a>
  );
}

function DocList({ nodeId, total }: { nodeId: string; total: number }) {
  const [docs, setDocs] = useState<CatalogDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(
    async (offset: number) => {
      setLoading(true);
      setError(false);
      try {
        const res = await fetch(
          `/api/topics/${encodeURIComponent(nodeId)}?offset=${offset}`
        );
        const json = (await res.json()) as TopicDocsResponse;
        if (json.error) throw new Error(json.error);
        setDocs((prev) => (offset === 0 ? json.docs : [...prev, ...json.docs]));
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    },
    [nodeId]
  );

  useEffect(() => {
    setDocs([]);
    load(0);
  }, [load]);

  if (error) {
    return (
      <div className="px-3 py-4 text-[13px] text-mute">
        Impossibile caricare i documenti.{" "}
        <button
          onClick={() => load(0)}
          className="font-medium text-link underline underline-offset-4"
        >
          Riprova
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {docs.map((d) => (
        <DocRow key={`${nodeId}-${d.id}`} doc={d} />
      ))}
      {loading && (
        <div className="flex items-center gap-2 px-3 py-2 text-[12.5px] text-mute">
          <SpinnerIcon className="h-3.5 w-3.5" />
          Caricamento…
        </div>
      )}
      {!loading && docs.length < total && (
        <button
          onClick={() => load(docs.length)}
          className="mt-1 w-full rounded-md border border-hairline px-3 py-2 text-[12.5px] font-medium text-body transition hover:border-hairline-strong hover:bg-canvas-soft"
        >
          Carica altri {Math.min(60, total - docs.length)} di {total}
        </button>
      )}
    </div>
  );
}

/* ========================================================================== */
/* Nodo ricorsivo: tema -> argomento -> sotto-argomento                        */
/* ========================================================================== */

const INDENT: Record<number, string> = {
  2: "",
  3: "ml-1 border-l border-hairline pl-3",
  4: "ml-1 border-l border-hairline pl-3",
};

function NodeBlock({ node, depth }: { node: TopicNode; depth: number }) {
  const [open, setOpen] = useState(false);
  const hasChildren = node.figli.length > 0;
  const isTheme = depth === 2;

  return (
    <div
      className={
        isTheme
          ? "overflow-hidden rounded-ds border border-hairline bg-canvas shadow-ds"
          : ""
      }
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex w-full items-center gap-2.5 text-left transition hover:bg-canvas-soft ${
          isTheme ? "px-4 py-3" : "rounded-md px-2 py-1.5"
        }`}
      >
        <motion.span
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ duration: 0.18 }}
          className="shrink-0 text-mute"
        >
          <ChevronIcon className={isTheme ? "h-4 w-4" : "h-3.5 w-3.5"} />
        </motion.span>
        <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-mute">
          {node.id}
        </span>
        <span
          className={`min-w-0 flex-1 truncate tracking-[-0.01em] text-ink ${
            isTheme ? "text-[15px] font-medium" : "text-[13.5px]"
          }`}
        >
          {node.label}
        </span>
        <span className="shrink-0 rounded-full border border-hairline bg-canvas-soft px-2 py-0.5 font-mono text-[10.5px] tabular-nums text-body">
          {node.count}
        </span>
      </button>

      {open && (
        <div
          className={`animate-panel-in ${
            isTheme ? "border-t border-hairline p-2" : `mt-0.5 ${INDENT[depth] ?? ""}`
          }`}
        >
          {hasChildren && (
            <div className="space-y-0.5">
              {node.figli.map((c) => (
                <NodeBlock key={c.id} node={c} depth={depth + 1} />
              ))}
            </div>
          )}

          {/* La normativa del nodo e' sempre in chiaro: aprire un argomento
              deve bastare a vedere che cosa contiene. */}
          <div className={hasChildren ? "mt-3" : ""}>
            {hasChildren && (
              <div className="mb-1 flex items-center gap-2 border-t border-hairline px-2 pt-2.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-mute">
                <DocIcon className="h-3 w-3" />
                {node.count} documenti in {node.label}
              </div>
            )}
            <DocList nodeId={node.id} total={node.count} />
          </div>
        </div>
      )}
    </div>
  );
}

/* ========================================================================== */
/* Nucleo + griglia delle aree                                                */
/* ========================================================================== */

function Nucleus({ total, aree }: { total: number; aree: number }) {
  return (
    <div className="flex flex-col items-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.94 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="flex h-[104px] w-[104px] flex-col items-center justify-center rounded-full border border-hairline-strong bg-canvas shadow-ds"
      >
        <span className="font-mono text-[26px] font-semibold leading-none tabular-nums tracking-[-0.03em] text-ink">
          {total}
        </span>
        <span className="mt-1 text-[11px] text-mute">documenti</span>
      </motion.div>

      {/* Ventaglio dei rami: si allarga verso la griglia sottostante. */}
      <svg
        viewBox="0 0 800 48"
        preserveAspectRatio="none"
        aria-hidden="true"
        className="h-8 w-full max-w-2xl text-hairline-strong"
      >
        {Array.from({ length: aree }, (_, i) => {
          const x = aree === 1 ? 400 : 60 + (i * 680) / (aree - 1);
          return (
            <line
              key={i}
              x1="400"
              y1="0"
              x2={x}
              y2="48"
              stroke="currentColor"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>
    </div>
  );
}

function AreaCard({
  node,
  onOpen,
  index,
}: {
  node: TopicNode;
  onOpen: () => void;
  index: number;
}) {
  const temi = node.figli.length;
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: Math.min(index * 0.025, 0.2) }}
      className="group flex flex-col items-start gap-2 rounded-ds border border-hairline bg-canvas p-4 text-left shadow-ds transition hover:border-hairline-strong hover:bg-canvas-soft focus:outline-none focus-visible:shadow-focus"
    >
      <div className="flex w-full items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-ink font-mono text-[13px] font-bold text-canvas">
          {node.id}
        </span>
        <span className="ml-auto shrink-0 rounded-full border border-hairline bg-canvas-soft px-2 py-0.5 font-mono text-[10.5px] tabular-nums text-body">
          {node.count}
        </span>
      </div>
      <span className="text-[14.5px] font-medium leading-snug tracking-[-0.015em] text-ink group-hover:text-link">
        {node.label}
      </span>
      <span className="font-mono text-[10.5px] text-mute">
        {temi} {temi === 1 ? "tema" : "temi"}
      </span>
    </motion.button>
  );
}

/* ========================================================================== */
/* Mappa                                                                       */
/* ========================================================================== */

export function TopicMap() {
  const [data, setData] = useState<TopicsResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/topics")
      .then((r) => r.json())
      .then((j: TopicsResponse) => {
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

  // Ripristina l'area dall'indirizzo, cosi' un argomento si puo' condividere.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("argomento");
    if (id) setSelected(id);
  }, []);

  const apri = useCallback((id: string | null) => {
    setSelected(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("argomento", id);
    else url.searchParams.delete("argomento");
    window.history.replaceState(null, "", url);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const area = useMemo(
    () => (selected ? data?.aree.find((a) => a.id === selected) ?? null : null),
    [data, selected]
  );

  if (status === "loading") return <ResultsSkeleton />;

  if (status === "error" || !data) {
    return (
      <div className="rounded-ds border border-dashed border-hairline p-6 text-center text-body">
        Impossibile costruire la mappa degli argomenti.
      </div>
    );
  }

  /* ---- Vista di un'area: briciole + albero annidato ---- */
  if (selected && (area || selected === "residuo")) {
    const label = area ? area.label : "Da classificare";
    const count = area ? area.count : data.residuo;

    return (
      <section className="w-full">
        <button
          onClick={() => apri(null)}
          className="mb-4 flex items-center gap-2 text-[13px] font-medium text-mute transition hover:text-ink"
        >
          <ArrowLeftIcon className="h-3.5 w-3.5" />
          Tutti gli argomenti
        </button>

        <div className="mb-5 flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ds bg-ink font-mono text-[15px] font-bold text-canvas">
            {area ? area.id : "?"}
          </span>
          <div className="min-w-0">
            <h2 className="text-[22px] font-semibold tracking-display-sm text-ink">
              {label}
            </h2>
            <p className="font-mono text-[11.5px] text-mute">
              {count} documenti
              {area && area.figli.length > 0 && ` · ${area.figli.length} temi`}
            </p>
          </div>
        </div>

        {area ? (
          <>
            <div className="space-y-2.5">
              {area.figli.map((t) => (
                <NodeBlock key={t.id} node={t} depth={2} />
              ))}
            </div>

            {/* Tutta la normativa dell'area, senza dover aprire un tema. */}
            <div className="mt-6 rounded-ds border border-hairline bg-canvas p-2 shadow-ds">
              <div className="mb-1 flex items-center gap-2 px-2 pt-1 font-mono text-[10.5px] uppercase tracking-[0.12em] text-mute">
                <DocIcon className="h-3 w-3" />
                {area.count} documenti in {area.label}
              </div>
              <DocList nodeId={area.id} total={area.count} />
            </div>
          </>
        ) : (
          <div className="rounded-ds border border-hairline bg-canvas p-2 shadow-ds">
            <p className="px-3 pb-2 pt-1 text-[13px] text-mute">
              Documenti che nessuna regola del lessico ha intercettato. Il loro
              numero misura quanto la mappa va ancora tarata.
            </p>
            <DocList nodeId="residuo" total={data.residuo} />
          </div>
        )}
      </section>
    );
  }

  /* ---- Vista d'insieme: nucleo + aree ---- */
  return (
    <section className="w-full">
      <div className="mb-4 flex items-baseline gap-3">
        <h2 className="font-mono text-[12px] uppercase tracking-[0.14em] text-mute">
          Mappa degli argomenti
        </h2>
        <span className="font-mono text-[12px] text-mute">
          {data.aree.length} aree · {data.classificati} classificati
        </span>
      </div>

      <Nucleus total={data.totale} aree={Math.max(data.aree.length, 1)} />

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {data.aree.map((a, i) => (
          <AreaCard key={a.id} node={a} index={i} onOpen={() => apri(a.id)} />
        ))}
      </div>

      {data.residuo > 0 && (
        <button
          onClick={() => apri("residuo")}
          className="mt-2.5 flex w-full items-center gap-2.5 rounded-ds border border-dashed border-hairline px-4 py-3 text-left transition hover:border-hairline-strong hover:bg-canvas-soft"
        >
          <span className="font-mono text-[13px] text-mute">?</span>
          <span className="text-[13.5px] text-body">Da classificare</span>
          <span className="ml-auto font-mono text-[11px] tabular-nums text-mute">
            {data.residuo}
          </span>
        </button>
      )}
    </section>
  );
}
