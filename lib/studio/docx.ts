import type { Dossier, FonteStudio } from "./tipi";
import { ETICHETTE_STATO, nomeAtto } from "./didattica";

/**
 * Esportazione del dossier in Word (.docx), generata nel browser con la
 * libreria `docx` (caricata solo al clic): copertina, sommario aggiornabile,
 * capitoli formattati con le citazioni [F n], tabella cronologica e
 * bibliografia con estremi e link. Nessuna chiamata al server ne' all'AI.
 */

type Docx = typeof import("docx");

const ORDINE = ["inquadramento", "origini", "evoluzione", "vigente", "avvertenze"];
const BLU = "1F4E8C";
const GRIGIO = "666666";
const anno = (a: string) => (a === "0000" ? "s.d." : a);

/** **grassetto**, *corsivo*, _corsivo_ e citazioni [F n] -> TextRun. */
function inline(D: Docx, testo: string, base: { size?: number } = {}): InstanceType<Docx["TextRun"]>[] {
  const parti = testo.split(/(\*\*[^*\n]+\*\*|\[\s*F\s*\d+(?:\s*[,;]\s*(?:F\s*)?\d+)*\s*\]|\*[^*\n]+\*|_[^_\n]+_)/g).filter(Boolean);
  return parti.map((p) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) return new D.TextRun({ text: p.slice(2, -2), bold: true, ...base });
    if (/^\[\s*F/.test(p)) {
      const n = (p.match(/\d+/g) ?? []).map((x) => `F${x}`).join(", ");
      return new D.TextRun({ text: `[${n}]`, color: BLU, size: 18 });
    }
    if (/^(\*[^*]+\*|_[^_]+_)$/.test(p)) return new D.TextRun({ text: p.slice(1, -1), italics: true, ...base });
    return new D.TextRun({ text: p, ...base });
  });
}

/** Markdown dei capitoli -> paragrafi Word (sottotitoli, elenchi, testo). */
function blocchi(D: Docx, md: string): InstanceType<Docx["Paragraph"]>[] {
  const out: InstanceType<Docx["Paragraph"]>[] = [];
  let paragrafo: string[] = [];
  const chiudi = () => {
    if (!paragrafo.length) return;
    out.push(new D.Paragraph({ children: inline(D, paragrafo.join(" ")), spacing: { after: 140, line: 300 } }));
    paragrafo = [];
  };
  for (const grezza of md.replace(/\r/g, "").split("\n")) {
    const r = grezza.trimEnd();
    const titolo = r.match(/^#{1,6}\s+(.*)$/);
    const puntata = r.match(/^\s*[-*•]\s+(.*)$/);
    const numerata = r.match(/^\s*\d+[.)]\s+(.*)$/);
    if (!r.trim()) chiudi();
    else if (titolo) {
      chiudi();
      out.push(new D.Paragraph({ heading: D.HeadingLevel.HEADING_2, children: [new D.TextRun({ text: titolo[1].replace(/\*\*/g, "") })], spacing: { before: 240, after: 120 } }));
    } else if (puntata) {
      chiudi();
      out.push(new D.Paragraph({ bullet: { level: 0 }, children: inline(D, puntata[1]), spacing: { after: 80 } }));
    } else if (numerata) {
      chiudi();
      out.push(new D.Paragraph({ numbering: { reference: "elenco-numerato", level: 0 }, children: inline(D, numerata[1]), spacing: { after: 80 } }));
    } else paragrafo.push(r.trim());
  }
  chiudi();
  return out;
}

const cella = (D: Docx, testo: string, opz: { grassetto?: boolean; larghezza: number; sfondo?: string }) =>
  new D.TableCell({
    width: { size: opz.larghezza, type: D.WidthType.PERCENTAGE },
    shading: opz.sfondo ? { type: D.ShadingType.CLEAR, color: "auto", fill: opz.sfondo } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new D.Paragraph({ children: [new D.TextRun({ text: testo, bold: opz.grassetto, size: 18 })] })],
  });

function assoluto(url: string, origine: string): string {
  try {
    return new URL(url, origine).toString();
  } catch {
    return url;
  }
}

/** Il documento Word del dossier. */
export function documentoDossier(D: Docx, d: Dossier, origine: string): InstanceType<Docx["Document"]> {
  const data = new Date(d.creatoIl).toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" });
  const perN = new Map(d.fonti.map((f) => [f.n, f]));
  const s = d.statistiche;
  const periodo = s.daAnno && s.aAnno ? ` · periodo ${anno(s.daAnno)}–${anno(s.aAnno)}` : "";

  const copertina = [
    new D.Paragraph({ spacing: { before: 2400 }, children: [new D.TextRun({ text: "STUDIO NORMATIVO", bold: true, color: BLU, size: 22, characterSpacing: 60 })] }),
    new D.Paragraph({ spacing: { before: 200, after: 300 }, children: [new D.TextRun({ text: d.argomento, bold: true, size: 56 })] }),
    new D.Paragraph({ children: [new D.TextRun({ text: `Dossier di studio cronologico · generato il ${data}`, color: GRIGIO, size: 22 })] }),
    new D.Paragraph({
      spacing: { after: 600 },
      children: [new D.TextRun({ text: `${s.trovate} fonti trovate nel database · ${s.analizzate} analizzate in dettaglio${periodo}`, color: GRIGIO, size: 22 })],
    }),
    new D.Paragraph({
      border: { top: { style: D.BorderStyle.SINGLE, size: 6, color: "BBBBBB", space: 8 } },
      children: [
        new D.TextRun({
          text: "BETA. Generato da un modello linguistico vincolato alle fonti del database FontiCatastali: ogni affermazione cita un documento [F n], elencato nella bibliografia. Non sostituisce la lettura dei testi ufficiali.",
          italics: true,
          color: GRIGIO,
          size: 18,
        }),
      ],
    }),
  ];

  const capitoli = [...d.sezioni]
    .sort((a, b) => ORDINE.indexOf(a.id) - ORDINE.indexOf(b.id))
    .flatMap((sez) => [new D.Paragraph({ heading: D.HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new D.TextRun({ text: sez.titolo })] }), ...blocchi(D, sez.markdown)]);

  const cronologia = d.timeline.length
    ? [
        new D.Paragraph({ heading: D.HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new D.TextRun({ text: "Cronologia" })] }),
        new D.Table({
          width: { size: 100, type: D.WidthType.PERCENTAGE },
          rows: [
            new D.TableRow({
              tableHeader: true,
              children: [
                cella(D, "Anno", { grassetto: true, larghezza: 10, sfondo: "E8EEF7" }),
                cella(D, "Atto", { grassetto: true, larghezza: 30, sfondo: "E8EEF7" }),
                cella(D, "Cambiamento", { grassetto: true, larghezza: 45, sfondo: "E8EEF7" }),
                cella(D, "Stato", { grassetto: true, larghezza: 15, sfondo: "E8EEF7" }),
              ],
            }),
            ...[...d.timeline]
              .sort((a, b) => a.anno.localeCompare(b.anno) || a.n - b.n)
              .map((v) => {
                const f = perN.get(v.n);
                return new D.TableRow({
                  children: [
                    cella(D, anno(v.anno), { larghezza: 10 }),
                    cella(D, `${f ? nomeAtto(f) : ""} [F${v.n}]`, { larghezza: 30 }),
                    cella(D, v.cambiamento.replace(/\[\s*F\s*\d+[^\]]*\]/g, "").trim(), { larghezza: 45 }),
                    cella(D, ETICHETTE_STATO[v.stato] ?? v.stato, { larghezza: 15 }),
                  ],
                });
              }),
          ],
        }),
      ]
    : [];

  const voceBibliografia = (f: FonteStudio) =>
    new D.Paragraph({
      spacing: { after: 100 },
      indent: { left: 567, hanging: 567 },
      children: [
        new D.TextRun({ text: `[F${f.n}] `, bold: true, color: BLU, size: 19 }),
        new D.TextRun({ text: nomeAtto(f), bold: true, size: 19 }),
        new D.TextRun({ text: `${nomeAtto(f) !== f.titolo ? ` — ${f.titolo}` : ""} (${anno(f.anno)}) · ${f.tipo}${f.livello === "menzione" ? " · citata di passaggio" : ""} · `, size: 19 }),
        new D.ExternalHyperlink({ link: assoluto(f.url, origine), children: [new D.TextRun({ text: assoluto(f.url, origine), style: "Hyperlink", size: 17 })] }),
      ],
    });
  const bibliografia = [
    new D.Paragraph({ heading: D.HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new D.TextRun({ text: "Bibliografia" })] }),
    new D.Paragraph({ spacing: { after: 160 }, children: [new D.TextRun({ text: "Fonti del database FontiCatastali, numerate in ordine cronologico come nel testo.", italics: true, color: GRIGIO, size: 18 })] }),
    ...[...d.fonti].sort((a, b) => a.n - b.n).map(voceBibliografia),
  ];

  return new D.Document({
    creator: "FontiCatastali",
    title: `Studio normativo: ${d.argomento}`,
    description: "Dossier dello Studio Normativo (BETA) di FontiCatastali",
    features: { updateFields: true },
    styles: {
      default: { document: { run: { font: "Calibri", size: 22 } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 34, bold: true, color: BLU }, paragraph: { spacing: { after: 200 } } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 24, bold: true, color: "333333" }, paragraph: { spacing: { before: 240, after: 120 } } },
      ],
    },
    numbering: {
      config: [
        {
          reference: "elenco-numerato",
          levels: [{ level: 0, format: D.LevelFormat.DECIMAL, text: "%1.", alignment: D.AlignmentType.START, style: { paragraph: { indent: { left: 567, hanging: 340 } } } }],
        },
      ],
    },
    sections: [
      { children: copertina },
      {
        headers: {
          default: new D.Header({
            children: [new D.Paragraph({ alignment: D.AlignmentType.RIGHT, children: [new D.TextRun({ text: `FontiCatastali · Studio normativo: ${d.argomento}`, size: 16, color: GRIGIO })] })],
          }),
        },
        footers: {
          default: new D.Footer({
            children: [
              new D.Paragraph({
                alignment: D.AlignmentType.CENTER,
                children: [new D.TextRun({ children: ["Pagina ", D.PageNumber.CURRENT, " di ", D.PageNumber.TOTAL_PAGES], size: 16, color: GRIGIO })],
              }),
            ],
          }),
        },
        children: [
          new D.Paragraph({ heading: D.HeadingLevel.HEADING_1, children: [new D.TextRun({ text: "Sommario" })] }),
          new D.TableOfContents("Sommario", { hyperlink: true, headingStyleRange: "1-2" }),
          new D.Paragraph({
            children: [new D.TextRun({ text: "Se il sommario è vuoto, in Word: tasto destro sul sommario → Aggiorna campo.", italics: true, color: GRIGIO, size: 16 })],
          }),
          ...capitoli,
          ...cronologia,
          ...bibliografia,
        ],
      },
    ],
  });
}

/** File .docx del dossier (Blob nel browser). */
export async function dossierDocx(d: Dossier, origine: string): Promise<Blob> {
  const D = await import("docx");
  return D.Packer.toBlob(documentoDossier(D, d, origine));
}
