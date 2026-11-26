import { SearchApp } from "@/components/SearchApp";
import { SiteHeader } from "@/components/SiteHeader";
import { NormieLazy } from "@/components/NormieLazy";
import { ArchivioStato } from "@/components/ArchivioStato";

export default function HomePage() {
  return (
    <main className="relative min-h-dvh overflow-hidden px-4 pb-24 pt-5 sm:pt-8">
      <SiteHeader attiva="ricerca" />

      <div className="mt-6 sm:mt-10">
        <SearchApp />
      </div>

      <ArchivioStato />

      {/* Widget chatbot giuridico (floating, in basso a destra). */}
      <NormieLazy />
    </main>
  );
}
