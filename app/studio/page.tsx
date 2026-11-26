import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { StudioApp } from "@/components/studio/StudioApp";

export const metadata: Metadata = {
  title: "Studio Normativo (BETA)",
  description:
    "Dossier di studio cronologici sulla normativa catastale: origini, evoluzione, disciplina vigente e citazioni verificabili su tutte le fonti del database.",
};

export default function StudioPage() {
  return (
    <main className="min-h-dvh px-4 pb-24 pt-5 sm:pt-8 print:p-0">
      <SiteHeader attiva="studio" larga />
      <div className="mt-6 sm:mt-8">
        <StudioApp />
      </div>
    </main>
  );
}
