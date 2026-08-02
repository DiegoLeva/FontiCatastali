"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CloseIcon, ExternalIcon, ChevronIcon } from "@/components/icons";
import type { NormieSource } from "@/lib/normie";

/** Filtri lato client, inviati a /api/normie. */
interface Filters {
  categorie?: string[];
  annoDa?: number;
  annoA?: number;
}

/* ------------------------------- Tipi UI -------------------------------- */

interface ChatMsg {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: NormieSource[];
  pending?: boolean; // true = placeholder "sta studiando…"
  error?: boolean;
}

const WELCOME: ChatMsg = {
  id: "welcome",
  role: "assistant",
  content:
    "Ciao! Sono **Normie**. Fammi una domanda sulla normativa e prassi catastale: cerco nei documenti, ragiono passo per passo e ti indico le fonti ufficiali.",
};

/* ------------------------------ Icone locali ---------------------------- */

function NormieIcon({ className }: { className?: string }) {
  // Bilancia stilizzata: firma "giuridica" del bot.
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12 3v18M7 21h10M5 7h14M12 7 6 9m6-2 6 2" />
      <path d="M6 9l-2.5 5a2.5 2.5 0 0 0 5 0L6 9Zm12 0-2.5 5a2.5 2.5 0 0 0 5 0L18 9Z" />
    </svg>
  );
}

function SendIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z" />
    </svg>
  );
}

/* --------------------- Rendering testo (sicuro, no HTML) ----------------- */

/**
 * Render minimale e XSS-safe: gestisce **grassetto** e a capo, senza
 * dangerouslySetInnerHTML (solo nodi React testuali + <strong>).
 */
function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, li) => (
        <span key={li} className="block">
          {line.split(/(\*\*[^*]+\*\*)/g).map((part, pi) =>
            part.startsWith("**") && part.endsWith("**") ? (
              <strong key={pi} className="font-semibold text-ink">
                {part.slice(2, -2)}
              </strong>
            ) : (
              <span key={pi}>{part}</span>
            )
          )}
        </span>
      ))}
    </>
  );
}

/* ---------------------- Animazione "sta studiando…" --------------------- */

function ThinkingDots() {
  return (
    <div
      className="flex items-center gap-2 text-mute"
      role="status"
      aria-live="polite"
    >
      <span className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-link"
            animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
            transition={{
              duration: 1,
              repeat: Infinity,
              delay: i * 0.15,
              ease: "easeInOut",
            }}
          />
        ))}
      </span>
      <span className="text-[13px]">Normie sta studiando la normativa…</span>
    </div>
  );
}

/* ------------------------------ Fonti (PDF) ----------------------------- */

function SourceButtons({ sources }: { sources: NormieSource[] }) {
  if (!sources.length) return null;
  return (
    <div className="mt-3 border-t border-hairline pt-3">
      <p className="mb-2 font-mono text-[11px] uppercase tracking-wide text-mute">
        Fonti
      </p>
      <div className="flex flex-col gap-1.5">
        {sources.map((s) => (
          <a
            key={s.n}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-2 rounded-ds border border-hairline bg-canvas px-2.5 py-1.5 text-left text-[13px] text-body transition-colors hover:border-link hover:bg-link-soft/40 hover:text-link-deep"
          >
            <span className="flex h-5 w-5 flex-none items-center justify-center rounded-full bg-canvas-soft-2 font-mono text-[11px] text-ink group-hover:bg-link group-hover:text-white">
              {s.n}
            </span>
            <span className="flex-1 truncate">
              {s.titolo}
              {s.anno !== "s.d." && (
                <span className="text-mute"> · {s.anno}</span>
              )}
            </span>
            <ExternalIcon className="h-3.5 w-3.5 flex-none text-mute group-hover:text-link" />
          </a>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ Componente ------------------------------ */

export function Normie() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  // Filtri avanzati (collassabili, non rubano spazio se chiusi).
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [categoria, setCategoria] = useState("");
  const [annoDa, setAnnoDa] = useState("");
  const [annoA, setAnnoA] = useState("");
  const [categorie, setCategorie] = useState<string[]>([]);
  const catFetched = useRef(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const hasActiveFilters =
    categoria !== "" || annoDa !== "" || annoA !== "";

  // Catalogo categorie: caricato pigramente alla prima apertura dei filtri.
  async function loadCategorie() {
    if (catFetched.current) return;
    catFetched.current = true;
    try {
      const res = await fetch("/api/catalog");
      const data = (await res.json()) as {
        categorie?: Array<{ cartella: string }>;
      };
      setCategorie(
        (data.categorie ?? []).map((c) => c.cartella).filter(Boolean)
      );
    } catch {
      catFetched.current = false; // consenti un nuovo tentativo
    }
  }

  function toggleFilters() {
    setFiltersOpen((o) => {
      if (!o) void loadCategorie();
      return !o;
    });
  }

  function resetFilters() {
    setCategoria("");
    setAnnoDa("");
    setAnnoA("");
  }

  /** Costruisce il payload filtri (solo campi valorizzati). */
  function buildFilters(): Filters | undefined {
    const f: Filters = {};
    if (categoria) f.categorie = [categoria];
    const da = parseInt(annoDa, 10);
    if (!Number.isNaN(da)) f.annoDa = da;
    const a = parseInt(annoA, 10);
    if (!Number.isNaN(a)) f.annoA = a;
    return Object.keys(f).length > 0 ? f : undefined;
  }

  // Auto-scroll all'ultimo messaggio.
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, open]);

  // Focus input + chiusura con Esc quando aperto.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 250);
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;

    const userMsg: ChatMsg = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };
    const pendingMsg: ChatMsg = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      pending: true,
    };

    // history: turni precedenti (esclude welcome e placeholder).
    const history = messages
      .filter((m) => m.id !== "welcome" && !m.pending && !m.error)
      .map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, userMsg, pendingMsg]);
    setInput("");
    setBusy(true);

    try {
      const filters = buildFilters();
      const res = await fetch("/api/normie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history,
          ...(filters ? { filters } : {}),
        }),
      });
      const data = (await res.json()) as {
        answer: string;
        sources: NormieSource[];
        error?: string;
      };

      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingMsg.id
            ? {
                ...m,
                pending: false,
                error: !!data.error,
                content:
                  data.error ||
                  data.answer ||
                  "Non ho ricevuto una risposta valida.",
                sources: data.sources,
              }
            : m
        )
      );
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingMsg.id
            ? {
                ...m,
                pending: false,
                error: true,
                content:
                  "Connessione non riuscita. Verifica la rete e riprova.",
              }
            : m
        )
      );
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send();
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end sm:bottom-6 sm:right-6">
      {/* Finestra chat */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            style={{ transformOrigin: "bottom right" }}
            role="dialog"
            aria-label="Chat con Normie"
            className="mb-3 flex h-[min(70vh,560px)] w-[min(92vw,400px)] flex-col overflow-hidden rounded-ds-lg border border-hairline bg-canvas shadow-ds-lg"
          >
            {/* Header */}
            <header className="flex flex-none items-center gap-2.5 border-b border-hairline bg-canvas-soft px-4 py-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-link text-white">
                <NormieIcon className="h-5 w-5" />
              </span>
              <div className="flex-1">
                <p className="text-[14px] font-semibold leading-tight text-ink">
                  Normie
                </p>
                <p className="font-mono text-[11px] leading-tight text-mute">
                  Assistente normativa catastale
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                aria-label="Chiudi la chat"
                className="rounded-ds p-1.5 text-mute transition-colors hover:bg-canvas-soft-2 hover:text-ink"
              >
                <CloseIcon className="h-5 w-5" />
              </button>
            </header>

            {/* Messaggi */}
            <div
              ref={scrollRef}
              className="scrollbar-thin flex-1 space-y-4 overflow-y-auto px-4 py-4"
            >
              {messages.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-ds-lg rounded-br-sm bg-link px-3.5 py-2 text-[14px] leading-relaxed text-white">
                      {m.content}
                    </div>
                  </div>
                ) : (
                  <div key={m.id} className="flex justify-start">
                    <div
                      className={`max-w-[92%] rounded-ds-lg rounded-bl-sm border px-3.5 py-2.5 text-[14px] leading-relaxed ${
                        m.error
                          ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
                          : "border-hairline bg-canvas-soft text-body"
                      }`}
                    >
                      {m.pending ? (
                        <ThinkingDots />
                      ) : (
                        <>
                          <RichText text={m.content} />
                          {m.sources && <SourceButtons sources={m.sources} />}
                        </>
                      )}
                    </div>
                  </div>
                )
              )}
            </div>

            {/* Input */}
            <form
              onSubmit={onSubmit}
              className="flex-none border-t border-hairline bg-canvas p-3"
            >
              {/* Barra filtri: toggle discreto + reset (visibile solo se attivi) */}
              <div className="mb-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={toggleFilters}
                  aria-expanded={filtersOpen}
                  className="flex items-center gap-1.5 rounded-ds px-1.5 py-1 text-[12px] text-mute transition-colors hover:text-ink"
                >
                  <span aria-hidden>⚙️</span>
                  Filtri avanzati
                  {hasActiveFilters && (
                    <span className="h-1.5 w-1.5 rounded-full bg-link" aria-hidden />
                  )}
                  <ChevronIcon
                    className={`h-3.5 w-3.5 transition-transform ${
                      filtersOpen ? "rotate-90" : ""
                    }`}
                  />
                </button>
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="rounded-ds px-1.5 py-1 text-[12px] text-mute transition-colors hover:text-link-deep"
                  >
                    Azzera
                  </button>
                )}
              </div>

              {/* Pannello collassabile: categoria + intervallo anni */}
              <AnimatePresence initial={false}>
                {filtersOpen && (
                  <motion.div
                    key="filters"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className="overflow-hidden"
                  >
                    <div className="mb-2 space-y-2 rounded-ds-lg border border-hairline bg-canvas-soft p-2.5">
                      <label className="block">
                        <span className="mb-1 block font-mono text-[10px] uppercase tracking-wide text-mute">
                          Categoria
                        </span>
                        <select
                          value={categoria}
                          onChange={(e) => setCategoria(e.target.value)}
                          className="w-full rounded-ds border border-hairline bg-canvas px-2 py-1.5 text-[13px] text-ink focus:border-link focus:outline-none"
                        >
                          <option value="">Tutte le categorie</option>
                          {categorie.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </label>

                      <div>
                        <span className="mb-1 block font-mono text-[10px] uppercase tracking-wide text-mute">
                          Anno
                        </span>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            inputMode="numeric"
                            min={1900}
                            max={2100}
                            value={annoDa}
                            onChange={(e) => setAnnoDa(e.target.value)}
                            placeholder="Da"
                            className="w-full rounded-ds border border-hairline bg-canvas px-2 py-1.5 text-[13px] text-ink placeholder:text-mute focus:border-link focus:outline-none"
                          />
                          <span className="text-mute" aria-hidden>
                            –
                          </span>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={1900}
                            max={2100}
                            value={annoA}
                            onChange={(e) => setAnnoA(e.target.value)}
                            placeholder="A"
                            className="w-full rounded-ds border border-hairline bg-canvas px-2 py-1.5 text-[13px] text-ink placeholder:text-mute focus:border-link focus:outline-none"
                          />
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex items-end gap-2 rounded-ds-lg border border-hairline bg-canvas-soft px-3 py-2 focus-within:border-link focus-within:shadow-focus">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={onKeyDown}
                  rows={1}
                  placeholder="Scrivi la tua domanda…"
                  className="max-h-28 flex-1 resize-none bg-transparent text-[14px] text-ink placeholder:text-mute focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={busy || !input.trim()}
                  aria-label="Invia"
                  className="flex h-8 w-8 flex-none items-center justify-center rounded-ds bg-link text-white transition-opacity hover:bg-link-deep disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <SendIcon className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-1.5 px-1 text-center font-mono text-[10px] text-mute">
                Normie può commettere errori: verifica sempre le fonti citate.
              </p>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating action button */}
      <motion.button
        onClick={() => setOpen((o) => !o)}
        whileTap={{ scale: 0.92 }}
        aria-label={open ? "Chiudi Normie" : "Apri Normie, assistente normativa"}
        aria-expanded={open}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-link text-white shadow-ds-lg transition-colors hover:bg-link-deep"
      >
        <AnimatePresence mode="wait" initial={false}>
          {open ? (
            <motion.span
              key="close"
              initial={{ rotate: -90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: 90, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <CloseIcon className="h-6 w-6" />
            </motion.span>
          ) : (
            <motion.span
              key="open"
              initial={{ rotate: 90, opacity: 0 }}
              animate={{ rotate: 0, opacity: 1 }}
              exit={{ rotate: -90, opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <NormieIcon className="h-6 w-6" />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
    </div>
  );
}
