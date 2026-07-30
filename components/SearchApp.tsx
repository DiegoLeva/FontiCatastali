"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { SearchResponse } from "@/lib/types";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { computeDecades, filterResponse } from "@/lib/decades";
import { SearchBar } from "./SearchBar";
import { FilterBar } from "./FilterBar";
import { ResultsTree } from "./ResultsTree";
import { ResultsSkeleton } from "./Skeletons";
import { SearchIcon } from "./icons";

const MIN_CHARS = 2;
const SUGGESTIONS = [
  "fabbricati rurali",
  "rendita catastale",
  "pregeo",
  "impianti fotovoltaici",
  "usi civici",
];

type Status = "idle" | "loading" | "done" | "error";

export function SearchApp() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [activeDecades, setActiveDecades] = useState<string[]>([]);

  const debounced = useDebouncedValue(query, 250);
  const abortRef = useRef<AbortController | null>(null);

  const runSearch = useCallback(async (q: string) => {
    const term = q.trim();
    abortRef.current?.abort();

    if (term.length < MIN_CHARS) {
      setStatus("idle");
      setData(null);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("loading");
    setErrorMsg("");

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, {
        signal: controller.signal,
      });
      const json = (await res.json()) as SearchResponse;
      if (controller.signal.aborted) return;
      if (!res.ok || json.error) throw new Error(json.error || "Errore server");
      setData(json);
      setStatus("done");
    } catch (err) {
      if ((err as Error).name === "AbortError") return; // richiesta superata
      setErrorMsg("Impossibile completare la ricerca. Riprova.");
      setStatus("error");
    }
  }, []);

  // Ricerca as-you-type (debounced).
  useEffect(() => {
    runSearch(debounced);
  }, [debounced, runSearch]);

  // Azzera i filtri ad ogni nuovo set di risultati.
  useEffect(() => {
    setActiveDecades([]);
  }, [data]);

  const decades = useMemo(
    () => (data ? computeDecades(data.groups) : []),
    [data]
  );
  const view = useMemo(
    () => (data ? filterResponse(data, activeDecades) : null),
    [data, activeDecades]
  );

  const toggleDecade = useCallback((key: string) => {
    setActiveDecades((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }, []);

  const hasResults = !!view && view.groups.length > 0;
  const isEmpty = status === "done" && !!view && view.groups.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      {/* Header / barra: centrata quando idle, in alto quando ci sono risultati */}
      <motion.header layout className="pt-2">
        <motion.div
          layout
          className={
            status === "idle" && !data
              ? "flex min-h-[42vh] flex-col items-center justify-center text-center"
              : ""
          }
        >
          {status === "idle" && !data && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6"
            >
              <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">
                Fonti<span className="text-brand-600">Catastali</span>
              </h1>
              <p className="mt-2 text-zinc-500 dark:text-zinc-400">
                Ricerca full-text nella normativa catastale italiana.
              </p>
            </motion.div>
          )}

          <div className="w-full">
            <SearchBar
              value={query}
              onChange={setQuery}
              onSubmit={() => runSearch(query)}
              onClear={() => {
                setQuery("");
                setData(null);
                setStatus("idle");
              }}
              loading={status === "loading"}
              autoFocus
            />
          </div>

          {/* Suggerimenti iniziali */}
          {status === "idle" && !data && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-5 flex flex-wrap items-center justify-center gap-2"
            >
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setQuery(s)}
                  className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-600 transition hover:border-brand-300 hover:text-brand-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-brand-700"
                >
                  {s}
                </button>
              ))}
            </motion.div>
          )}
        </motion.div>
      </motion.header>

      {/* Corpo risultati — rendering condizionale diretto (niente
          AnimatePresence mode="wait": le animazioni d'entrata vivono nei
          singoli blocchi e in ResultsTree, evitando exit "bloccati"). */}
      <div className="mt-6">
        {status === "loading" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <ResultsSkeleton />
          </motion.div>
        )}

        {status === "error" && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
          >
            {errorMsg}
            <button
              onClick={() => runSearch(query)}
              className="mt-3 block w-full text-sm font-semibold underline underline-offset-4"
            >
              Riprova
            </button>
          </motion.div>
        )}

        {isEmpty && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-zinc-200 py-14 text-center dark:border-zinc-800"
          >
            <SearchIcon className="h-8 w-8 text-zinc-300 dark:text-zinc-600" />
            {activeDecades.length > 0 ? (
              <>
                <p className="text-zinc-600 dark:text-zinc-300">
                  Nessun documento per i filtri selezionati.
                </p>
                <button
                  onClick={() => setActiveDecades([])}
                  className="text-sm font-semibold text-brand-600 underline underline-offset-4"
                >
                  Rimuovi i filtri
                </button>
              </>
            ) : (
              <>
                <p className="text-zinc-600 dark:text-zinc-300">
                  Nessun risultato per{" "}
                  <span className="font-semibold">“{data?.query}”</span>.
                </p>
                <p className="text-sm text-zinc-400">
                  Prova con termini più generici o controlla l&apos;ortografia.
                </p>
              </>
            )}
          </motion.div>
        )}

        {status === "done" && hasResults && view && (
          <>
            <FilterBar
              decades={decades}
              active={activeDecades}
              onToggle={toggleDecade}
              onReset={() => setActiveDecades([])}
            />
            <ResultsTree data={view} />
          </>
        )}
      </div>
    </div>
  );
}
