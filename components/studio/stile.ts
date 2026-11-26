import type { RuoloFonte, StatoFonte } from "@/lib/studio/tipi";

/** Etichette e colori dei ruoli delle fonti (timeline, drawer, indice). */
export const RUOLI: Record<RuoloFonte, { label: string; badge: string; punto: string }> = {
  istitutivo: { label: "Istitutivo", badge: "border-[#0070f340] bg-[#0070f314] text-[#0761d1] dark:text-[#9ecbff]", punto: "bg-[#0070f3]" },
  modifica: { label: "Modifica", badge: "border-[#7928ca40] bg-[#7928ca14] text-[#6a1fb5] dark:text-[#c9a3f5]", punto: "bg-[#7928ca]" },
  chiarimento: { label: "Chiarimento", badge: "border-[#0e7c7b40] bg-[#0e7c7b14] text-[#0b6665] dark:text-[#6fd6d4]", punto: "bg-[#0e7c7b]" },
  operativo: { label: "Operativo", badge: "border-[#b4530940] bg-[#b4530914] text-[#9a4a07] dark:text-[#f5b86a]", punto: "bg-[#b45309]" },
  abrogazione: { label: "Abroga/supera", badge: "border-[#c5000040] bg-[#c5000012] text-[#b00000] dark:text-[#ff8080]", punto: "bg-[#c50000]" },
  giurisprudenza: { label: "Giurisprudenza", badge: "border-hairline-strong bg-canvas-soft-2 text-ink", punto: "bg-ink" },
  contesto: { label: "Contesto", badge: "border-hairline bg-canvas-soft text-mute", punto: "bg-hairline-strong" },
};

export const STATI: Record<StatoFonte, { label: string; badge: string }> = {
  vigente: { label: "Vigente", badge: "border-[#0a7a3440] bg-[#0a7a3412] text-[#0a6b2e] dark:text-[#5fd38d]" },
  superato: { label: "Superato", badge: "border-[#c5000040] bg-[#c5000010] text-[#b00000] line-through decoration-1 dark:text-[#ff8080]" },
  incerto: { label: "Stato incerto", badge: "border-hairline bg-canvas-soft text-mute" },
};

export const annoBreve = (a: string) => (a === "0000" ? "s.d." : a);
