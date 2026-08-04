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
import { MeshGradient } from "./MeshGradient";
import { Logo } from "./Logo";
import { ExactToggle } from "./ExactToggle";
import { BrowseTree } from "./BrowseTree";
import { BrowseSwitch, type BrowseMode } from "./BrowseSwitch";
import { TopicMap } from "./TopicMap";
import { SearchIcon } from "./icons";

const MIN_CHARS = 2;

type Status = "idle" | "loading" | "done" | "error";

export function SearchApp() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [activeDecades, setActiveDecades] = useState<string[]>([]);
  const [exact, setExact] = useState(false);
  const [browseMode, setBrowseMode] = useState<BrowseMode>("cartelle");

  const debounced = useDebouncedValue(query, 250);
  const abortRef = useRef<AbortController | null>(null);

  const runSearch = useCallback(async (q: string, exactMode: boolean) => {
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
      const url = `/api/search?q=${encodeURIComponent(term)}${
        exactMode ? "&exact=1" : ""
      }`;
      const res = await fetch(url, { signal: controller.signal });
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

  // Ricerca as-you-type (debounced); ri-parte anche al cambio di "esatta".
  useEffect(() => {
    runSearch(debounced, exact);
  }, [debounced, exact, runSearch]);

  // Azzera i filtri ad ogni nuovo set di risultati.
  useEffect(() => {
    setActiveDecades([]);
  }, [data]);

  // Un indirizzo con ?argomento=... apre direttamente la mappa su quel nodo.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("argomento")) {
      setBrowseMode("argomenti");
    }
  }, []);

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
  const heroActive = status === "idle" && !data;

  return (
    <div className="relative mx-auto flex w-full max-w-3xl flex-col">
      <MeshGradient active={heroActive} />

      <header className="pt-2">
        <div
          className={
            heroActive
              ? "flex flex-col items-center pt-[5vh] text-center sm:pt-[8vh]"
              : ""
          }
        >
          {heroActive && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-8 flex flex-col items-center"
            >
              <Logo className="h-11 w-11 text-ink" />
              <h1 className="mt-5 text-[30px] font-semibold tracking-display-lg text-ink sm:text-[38px]">
                Cerca nel database
              </h1>
            </motion.div>
          )}

          <div className="mx-auto w-full max-w-2xl">
            <SearchBar
              value={query}
              onChange={setQuery}
              onSubmit={() => runSearch(query, exact)}
              onClear={() => {
                setQuery("");
                setData(null);
                setStatus("idle");
              }}
              loading={status === "loading"}
              autoFocus
            />
            <ExactToggle value={exact} onChange={setExact} />
          </div>
        </div>
      </header>

      {/* Corpo risultati — rendering condizionale diretto. */}
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
            className="rounded-ds border border-[#ee000033] bg-[#ee00000d] p-6 text-center text-[#c50000] dark:text-[#ff6666]"
          >
            {errorMsg}
            <button
              onClick={() => runSearch(query, exact)}
              className="mt-3 block w-full text-sm font-medium underline underline-offset-4"
            >
              Riprova
            </button>
          </motion.div>
        )}

        {isEmpty && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center gap-3 rounded-ds border border-dashed border-hairline py-14 text-center"
          >
            <SearchIcon className="h-8 w-8 text-mute" />
            {activeDecades.length > 0 ? (
              <>
                <p className="text-body">
                  Nessun documento per i filtri selezionati.
                </p>
                <button
                  onClick={() => setActiveDecades([])}
                  className="text-sm font-medium text-link underline underline-offset-4"
                >
                  Rimuovi i filtri
                </button>
              </>
            ) : (
              <>
                <p className="text-body">
                  Nessun risultato per{" "}
                  <span className="font-medium text-ink">
                    “{data?.query}”
                  </span>
                  .
                </p>
                <p className="text-sm text-mute">
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

        {/* Consultazione libera, mostrata quando non si sta cercando: mappa
            degli argomenti oppure albero per cartella e anno. */}
        {heroActive && (
          <div className="mt-10">
            <BrowseSwitch mode={browseMode} onChange={setBrowseMode} />
            {browseMode === "argomenti" ? <TopicMap /> : <BrowseTree />}
          </div>
        )}
      </div>
    </div>
  );
}
