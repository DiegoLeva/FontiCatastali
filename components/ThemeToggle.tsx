"use client";

import { useEffect, useState } from "react";
import { SunIcon, MoonIcon } from "./icons";

/**
 * Toggle tema chiaro/scuro. Stato iniziale = classe `dark` gia' impostata
 * dallo script anti-FOUC in layout (localStorage o preferenza di sistema).
 * La scelta viene persistita in localStorage.
 */
export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      /* storage non disponibile: ignora */
    }
    setDark(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Cambia tema chiaro/scuro"
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-600 shadow-soft transition hover:text-brand-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:text-brand-400"
    >
      {/* Prima dell'idratazione (dark === null) non mostriamo nulla per
          evitare mismatch: subito dopo appare l'icona corretta. */}
      {dark === null ? null : dark ? (
        <SunIcon className="h-5 w-5" />
      ) : (
        <MoonIcon className="h-5 w-5" />
      )}
    </button>
  );
}
