import { SearchApp } from "@/components/SearchApp";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function HomePage() {
  return (
    <main className="relative min-h-dvh px-4 pb-24 pt-8 sm:pt-14">
      <div className="absolute right-4 top-4 sm:right-6 sm:top-6">
        <ThemeToggle />
      </div>

      <SearchApp />

      <footer className="mx-auto mt-16 max-w-3xl text-center text-xs text-zinc-400 dark:text-zinc-600">
        FontiCatastali · ricerca full-text su normativa catastale · Turso +
        Next.js
      </footer>
    </main>
  );
}
