"use client";

import { useRef } from "react";
import { motion } from "framer-motion";
import { SearchIcon, SpinnerIcon, CloseIcon } from "./icons";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onClear: () => void;
  loading: boolean;
  autoFocus?: boolean;
}

export function SearchBar({
  value,
  onChange,
  onSubmit,
  onClear,
  loading,
  autoFocus,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <motion.form
      layout
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
        inputRef.current?.blur();
      }}
      className="group relative w-full"
    >
      <div className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400 transition-colors group-focus-within:text-brand-600">
        {loading ? (
          <SpinnerIcon className="h-5 w-5" />
        ) : (
          <SearchIcon className="h-5 w-5" />
        )}
      </div>

      <input
        ref={inputRef}
        type="search"
        inputMode="search"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Cerca nella normativa catastale…"
        aria-label="Cerca nella normativa catastale"
        enterKeyHint="search"
        className="w-full rounded-2xl border border-zinc-200 bg-white py-4 pl-12 pr-12 text-base text-zinc-900 shadow-soft outline-none transition
                   placeholder:text-zinc-400
                   focus:border-brand-500 focus:shadow-focus
                   dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500
                   [&::-webkit-search-cancel-button]:appearance-none"
      />

      {value && (
        <button
          type="button"
          onClick={onClear}
          aria-label="Cancella ricerca"
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      )}
    </motion.form>
  );
}
