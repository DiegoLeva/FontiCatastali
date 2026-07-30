"use client";

import { useRef } from "react";
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
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
        inputRef.current?.blur();
      }}
      className="group relative w-full"
    >
      <div className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-mute transition-colors group-focus-within:text-ink">
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
        placeholder="Cerca circolari, risoluzioni, sentenze…"
        aria-label="Cerca nella normativa catastale"
        enterKeyHint="search"
        className="h-14 w-full rounded-ds border border-hairline bg-canvas pl-12 pr-12 text-base tracking-[-0.01em] text-ink shadow-ds outline-none transition
                   placeholder:text-mute
                   focus:border-link focus:shadow-focus
                   [&::-webkit-search-cancel-button]:appearance-none"
      />

      {value && (
        <button
          type="button"
          onClick={onClear}
          aria-label="Cancella ricerca"
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-mute transition hover:bg-canvas-soft-2 hover:text-ink"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      )}
    </form>
  );
}
