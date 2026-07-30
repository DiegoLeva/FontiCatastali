import { SearchApp } from "@/components/SearchApp";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function HomePage() {
  return (
    <main className="relative min-h-dvh overflow-hidden px-4 pb-24 pt-6 sm:pt-10">
      <div className="mx-auto flex max-w-3xl items-center justify-between">
        <span className="font-mono text-[13px] font-medium tracking-[-0.01em] text-ink">
          FontiCatastali
        </span>
        <ThemeToggle />
      </div>

      <div className="mt-6 sm:mt-10">
        <SearchApp />
      </div>

      <footer className="mx-auto mt-20 max-w-3xl border-t border-hairline pt-6 text-center font-mono text-[11px] uppercase tracking-[0.12em] text-mute">
        Ricerca full-text · Turso + Next.js
      </footer>
    </main>
  );
}
