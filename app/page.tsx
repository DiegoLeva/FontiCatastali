import { SearchApp } from "@/components/SearchApp";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Logo } from "@/components/Logo";
import { Normie } from "@/components/Normie";

export default function HomePage() {
  return (
    <main className="relative min-h-dvh overflow-hidden px-4 pb-24 pt-6 sm:pt-8">
      <div className="mx-auto flex max-w-3xl items-center justify-between">
        <div className="flex items-center gap-2 text-ink">
          <Logo className="h-5 w-5" />
          <span className="font-mono text-[13px] font-medium tracking-[-0.01em]">
            FontiCatastali
          </span>
        </div>
        <ThemeToggle />
      </div>

      <div className="mt-6 sm:mt-10">
        <SearchApp />
      </div>

      {/* Widget chatbot giuridico (floating, in basso a destra). */}
      <Normie />
    </main>
  );
}
