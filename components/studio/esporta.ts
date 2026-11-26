import type { Dossier } from "@/lib/studio/tipi";

const anno = (a: string) => (a === "0000" ? "s.d." : a);

/** Dossier in Markdown, con indice delle fonti e URL assoluti. */
export function dossierMarkdown(d: Dossier, origine: string): string {
  const assoluto = (u: string) => {
    try {
      return new URL(u, origine).toString();
    } catch {
      return u;
    }
  };
  const data = new Date(d.creatoIl).toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" });
  const out: string[] = [
    `# Studio normativo: ${d.argomento}`,
    "",
    `_Dossier generato il ${data} da FontiCatastali — Studio Normativo (BETA) su ${d.statistiche.trovate} fonti del database (${d.statistiche.analizzate} analizzate in dettaglio). Le citazioni [F n] rimandano all'indice delle fonti in fondo. Verificare sempre i testi ufficiali._`,
    "",
  ];
  const ordine = ["inquadramento", "origini", "evoluzione", "vigente", "avvertenze"];
  const sezioni = [...d.sezioni].sort((a, b) => ordine.indexOf(a.id) - ordine.indexOf(b.id));
  for (const s of sezioni) {
    out.push(`## ${s.titolo}`, "", s.markdown.trim(), "");
    if (s.id === "inquadramento" && d.timeline.length) {
      out.push("## Timeline", "");
      for (const v of d.timeline) {
        const f = d.fonti.find((x) => x.n === v.n);
        out.push(`- **${anno(v.anno)}** — ${f?.titolo ?? ""} [F${v.n}]: ${v.cambiamento}`);
      }
      out.push("");
    }
  }
  out.push("## Indice delle fonti", "");
  for (const f of d.fonti) {
    out.push(`- [F${f.n}] ${f.titolo} (${anno(f.anno)}) — ${f.tipo}${f.livello === "menzione" ? ", menzione" : ""} — ${assoluto(f.url)}`);
  }
  out.push("", "## Termini cercati", "", d.espansione.map((c) => `${c.etichetta} (${c.documenti})`).join(" · "), "");
  return out.join("\n");
}
