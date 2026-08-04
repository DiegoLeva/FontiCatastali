"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type {
  CatalogDoc,
  TopicDocsResponse,
  TopicNode,
  TopicsResponse,
} from "@/lib/types";
import { ResultsSkeleton } from "./Skeletons";
import { ChevronIcon, DocIcon, ExternalIcon, SpinnerIcon } from "./icons";

/* ========================================================================== */
/* Percorso                                                                    */
/* ========================================================================== */

/**
 * Gli identificativi codificano la gerarchia ("A2.5.1"), quindi la catena degli
 * antenati si ricava dalla stringa: nessuna ricerca nell'albero.
 */
function antenati(id: string): string[] {
  const parti = id.split(".");
  const radice = parti[0];
  const out: string[] = [radice[0]];
  if (radice.length > 1) out.push(radice);
  for (let i = 1; i < parti.length; i++) out.push(parti.slice(0, i + 1).join("."));
  return out;
}

function appiattisci(aree: TopicNode[]): Map<string, TopicNode> {
  const m = new Map<string, TopicNode>();
  const visita = (n: TopicNode) => {
    m.set(n.id, n);
    n.figli.forEach(visita);
  };
  aree.forEach(visita);
  return m;
}

/* ========================================================================== */
/* Documenti                                                                   */
/* ========================================================================== */

function DocRow({ doc, i }: { doc: CatalogDoc; i: number }) {
  const label = doc.titolo && doc.titolo !== "s.n." ? doc.titolo : doc.nomeFile;
  return (
    <motion.a
      href={doc.url}
      target="_blank"
      rel="noopener noreferrer"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, delay: Math.min(i * 0.012, 0.25) }}
      className="group/doc flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 transition hover:border-hairline hover:bg-canvas-soft"
    >
      <DocIcon className="h-3.5 w-3.5 shrink-0 text-mute group-hover/doc:text-link" />
      <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink group-hover/doc:text-link">
        {label}
      </span>
      {doc.anno !== "0000" && (
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-mute">
          {doc.anno}
        </span>
      )}
      <ExternalIcon className="h-3 w-3 shrink-0 text-mute opacity-0 transition group-hover/doc:opacity-100" />
    </motion.a>
  );
}

/** Cache dei documenti gia' scaricati: tornare indietro non ricarica nulla. */
type DocCache = Map<string, { docs: CatalogDoc[]; totale: number }>;

function DocPanel({
  nodeId,
  total,
  cache,
}: {
  nodeId: string;
  total: number;
  cache: DocCache;
}) {
  const [stato, setStato] = useState(() => cache.get(nodeId) ?? null);
  const [loading, setLoading] = useState(!cache.has(nodeId));
  const [errore, setErrore] = useState(false);

  const carica = useCallback(
    async (offset: number) => {
      setLoading(true);
      setErrore(false);
      try {
        const res = await fetch(
          `/api/topics/${encodeURIComponent(nodeId)}?offset=${offset}`
        );
        const json = (await res.json()) as TopicDocsResponse;
        if (json.error) throw new Error(json.error);
        const prec = offset === 0 ? [] : stato?.docs ?? [];
        const agg = { docs: [...prec, ...json.docs], totale: json.totale };
        cache.set(nodeId, agg);
        setStato(agg);
      } catch {
        setErrore(true);
      } finally {
        setLoading(false);
      }
    },
    [nodeId, stato, cache]
  );

  useEffect(() => {
    const salvato = cache.get(nodeId);
    if (salvato) {
      setStato(salvato);
      setLoading(false);
      return;
    }
    setStato(null);
    carica(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  if (errore) {
    return (
      <div className="px-3 py-4 text-[13px] text-mute">
        Impossibile caricare i documenti.{" "}
        <button
          onClick={() => carica(0)}
          className="font-medium text-link underline underline-offset-4"
        >
          Riprova
        </button>
      </div>
    );
  }

  const docs = stato?.docs ?? [];

  return (
    <div>
      <div className="mb-1 flex items-center gap-2 px-3 font-mono text-[10.5px] uppercase tracking-[0.14em] text-mute">
        <DocIcon className="h-3 w-3" />
        {total} {total === 1 ? "documento" : "documenti"}
      </div>
      <div className="space-y-0.5">
        {docs.map((d, i) => (
          <DocRow key={`${nodeId}-${d.id}`} doc={d} i={i} />
        ))}
      </div>
      {loading && (
        <div className="flex items-center gap-2 px-3 py-3 text-[12.5px] text-mute">
          <SpinnerIcon className="h-3.5 w-3.5" />
          Caricamento…
        </div>
      )}
      {!loading && stato && docs.length < stato.totale && (
        <button
          onClick={() => carica(docs.length)}
          className="mt-2 w-full rounded-lg border border-hairline px-3 py-2.5 text-[13px] font-medium text-body transition hover:border-hairline-strong hover:bg-canvas-soft"
        >
          Mostra altri {Math.min(60, stato.totale - docs.length)}
        </button>
      )}
    </div>
  );
}

/* ========================================================================== */
/* Tessera di sottocategoria                                                   */
/* ========================================================================== */

function Tile({
  node,
  max,
  onOpen,
  i,
}: {
  node: TopicNode;
  max: number;
  onOpen: () => void;
  i: number;
}) {
  const quota = max > 0 ? Math.max(node.count / max, 0.04) : 0;
  const sotto = node.figli.length;
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: Math.min(i * 0.02, 0.18) }}
      className="group relative flex flex-col gap-2 overflow-hidden rounded-xl border border-hairline bg-canvas p-4 text-left shadow-ds transition hover:-translate-y-0.5 hover:border-hairline-strong hover:shadow-ds-lg focus:outline-none focus-visible:shadow-focus"
    >
      <div className="flex items-start gap-3">
        <span className="min-w-0 flex-1 text-[14.5px] font-medium leading-snug tracking-[-0.015em] text-ink group-hover:text-link">
          {node.label}
        </span>
        <span className="shrink-0 font-mono text-[15px] font-semibold tabular-nums text-ink">
          {node.count}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[11.5px] text-mute">
          {sotto > 0
            ? `${sotto} ${sotto === 1 ? "sottocategoria" : "sottocategorie"}`
            : "argomento finale"}
        </span>
        <ChevronIcon className="ml-auto h-3.5 w-3.5 shrink-0 text-mute transition group-hover:translate-x-0.5 group-hover:text-link" />
      </div>

      {/* Peso relativo tra fratelli: si legge il volume senza contare. */}
      <span className="absolute inset-x-0 bottom-0 h-[3px] bg-canvas-soft-2">
        <motion.span
          initial={{ scaleX: 0 }}
          animate={{ scaleX: quota }}
          transition={{ duration: 0.45, delay: 0.1, ease: "easeOut" }}
          style={{ transformOrigin: "left" }}
          className="block h-full bg-link/45 group-hover:bg-link"
        />
      </span>
    </motion.button>
  );
}

/* ========================================================================== */
/* Nucleo d'ingresso                                                           */
/* ========================================================================== */

function Nucleo({ totale, rami }: { totale: number; rami: number }) {
  return (
    <div className="flex flex-col items-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="flex h-[108px] w-[108px] flex-col items-center justify-center rounded-full border border-hairline-strong bg-canvas shadow-ds"
      >
        <span className="font-mono text-[27px] font-semibold leading-none tabular-nums tracking-[-0.03em] text-ink">
          {totale}
        </span>
        <span className="mt-1 text-[11px] text-mute">documenti</span>
      </motion.div>

      <svg
        viewBox="0 0 800 48"
        preserveAspectRatio="none"
        aria-hidden="true"
        className="h-9 w-full max-w-2xl text-hairline-strong"
      >
        {Array.from({ length: rami }, (_, i) => {
          const x = rami === 1 ? 400 : 60 + (i * 680) / (rami - 1);
          return (
            <motion.line
              key={i}
              x1="400"
              y1="0"
              x2={x}
              y2="48"
              stroke="currentColor"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.15 + i * 0.03 }}
            />
          );
        })}
      </svg>
    </div>
  );
}

/* ========================================================================== */
/* Mappa                                                                       */
/* ========================================================================== */

export function TopicMap() {
  const [data, setData] = useState<TopicsResponse | null>(null);
  const [stato, setStato] = useState<"loading" | "done" | "error">("loading");
  const [nodo, setNodo] = useState<string | null>(null);
  const cache = useRef<DocCache>(new Map()).current;

  useEffect(() => {
    let vivo = true;
    fetch("/api/topics")
      .then((r) => r.json())
      .then((j: TopicsResponse) => {
        if (!vivo) return;
        if (j.error) throw new Error(j.error);
        setData(j);
        setStato("done");
      })
      .catch(() => vivo && setStato("error"));
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("argomento");
    if (id) setNodo(id);
  }, []);

  const vai = useCallback((id: string | null) => {
    setNodo(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("argomento", id);
    else url.searchParams.delete("argomento");
    window.history.replaceState(null, "", url);
  }, []);

  const indice = useMemo(() => (data ? appiattisci(data.aree) : new Map()), [data]);

  if (stato === "loading") return <ResultsSkeleton />;
  if (stato === "error" || !data) {
    return (
      <div className="rounded-ds border border-dashed border-hairline p-6 text-center text-body">
        Impossibile costruire la mappa degli argomenti.
      </div>
    );
  }

  const corrente: TopicNode | null = nodo ? indice.get(nodo) ?? null : null;
  const isResiduo = nodo === "residuo";
  const catena = corrente ? antenati(corrente.id) : [];

  /* ---- Dentro un nodo ---- */
  if (corrente || isResiduo) {
    const label = corrente ? corrente.label : "Da classificare";
    const count = corrente ? corrente.count : data.residuo;
    const figli = corrente?.figli ?? [];
    const max = figli.reduce((m, f) => Math.max(m, f.count), 0);

    return (
      <section className="w-full">
        {/* Briciole: il percorso e' sempre visibile e sempre cliccabile. */}
        <nav className="mb-5 flex flex-wrap items-center gap-1 text-[12.5px]">
          <button
            onClick={() => vai(null)}
            className="rounded-md px-1.5 py-1 text-mute transition hover:bg-canvas-soft hover:text-ink"
          >
            Tutti gli argomenti
          </button>
          {catena.map((id, i) => {
            const n = indice.get(id);
            if (!n) return null;
            const ultimo = i === catena.length - 1;
            return (
              <span key={id} className="flex items-center gap-1">
                <ChevronIcon className="h-3 w-3 shrink-0 text-hairline-strong" />
                {ultimo ? (
                  <span className="px-1.5 py-1 font-medium text-ink">{n.label}</span>
                ) : (
                  <button
                    onClick={() => vai(id)}
                    className="rounded-md px-1.5 py-1 text-mute transition hover:bg-canvas-soft hover:text-ink"
                  >
                    {n.label}
                  </button>
                )}
              </span>
            );
          })}
          {isResiduo && (
            <span className="flex items-center gap-1">
              <ChevronIcon className="h-3 w-3 shrink-0 text-hairline-strong" />
              <span className="px-1.5 py-1 font-medium text-ink">{label}</span>
            </span>
          )}
        </nav>

        <AnimatePresence mode="wait">
          <motion.div
            key={nodo}
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <div className="mb-5">
              <h2 className="text-[26px] font-semibold leading-tight tracking-display-sm text-ink">
                {label}
              </h2>
              <p className="mt-1 text-[13px] text-mute">
                {count} {count === 1 ? "documento" : "documenti"}
                {figli.length > 0 &&
                  ` · ${figli.length} ${
                    figli.length === 1 ? "sottocategoria" : "sottocategorie"
                  }`}
              </p>
            </div>

            {figli.length > 0 && (
              <div className="mb-8 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {figli.map((f, i) => (
                  <Tile
                    key={f.id}
                    node={f}
                    max={max}
                    i={i}
                    onOpen={() => vai(f.id)}
                  />
                ))}
              </div>
            )}

            <div className="rounded-xl border border-hairline bg-canvas p-2 pt-3 shadow-ds">
              {isResiduo && (
                <p className="px-3 pb-3 text-[13px] text-mute">
                  Documenti che nessuna regola del lessico ha intercettato. Il
                  loro numero misura quanto la mappa va ancora tarata.
                </p>
              )}
              <DocPanel
                nodeId={nodo!}
                total={count}
                cache={cache}
              />
            </div>
          </motion.div>
        </AnimatePresence>
      </section>
    );
  }

  /* ---- Ingresso ---- */
  const maxArea = data.aree.reduce((m, a) => Math.max(m, a.count), 0);

  return (
    <section className="w-full">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-mono text-[12px] uppercase tracking-[0.14em] text-mute">
          Mappa degli argomenti
        </h2>
        <span className="font-mono text-[12px] text-mute">
          {data.aree.length} aree · {data.classificati} classificati ·{" "}
          {data.residuo} da classificare
        </span>
      </div>

      <Nucleo totale={data.totale} rami={Math.max(data.aree.length, 1)} />

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {data.aree.map((a, i) => (
          <Tile key={a.id} node={a} max={maxArea} i={i} onOpen={() => vai(a.id)} />
        ))}
      </div>

      {data.residuo > 0 && (
        <button
          onClick={() => vai("residuo")}
          className="mt-2.5 flex w-full items-center gap-3 rounded-xl border border-dashed border-hairline px-4 py-3.5 text-left transition hover:border-hairline-strong hover:bg-canvas-soft"
        >
          <span className="text-[13.5px] text-body">Da classificare</span>
          <span className="ml-auto font-mono text-[13px] tabular-nums text-mute">
            {data.residuo}
          </span>
          <ChevronIcon className="h-3.5 w-3.5 shrink-0 text-mute" />
        </button>
      )}
    </section>
  );
}
