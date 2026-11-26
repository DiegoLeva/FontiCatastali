"use client";

import { Fragment, type ReactNode } from "react";
import type { FonteStudio } from "@/lib/studio/tipi";

/* -------------------------------------------------------------------------- */
/* Evidenziazione dei termini (estratti, lettore)                              */
/* -------------------------------------------------------------------------- */

/**
 * Regex unica dai sorgenti dei concetti. Le lookbehind non sono supportate dai
 * Safari piu' vecchi: in quel caso niente evidenziazione, mai un errore.
 */
export function regexEvidenzia(sorgenti: string[]): RegExp | null {
  if (!sorgenti.length) return null;
  try {
    return new RegExp(sorgenti.map((s) => `(?:${s})`).join("|"), "giu");
  } catch {
    try {
      const semplici = sorgenti.map((s) => s.replace(/\(\?<!\[[^\]]*\]\)/g, "\\b").replace(/\(\?<![^)]*\)/g, ""));
      return new RegExp(semplici.map((s) => `(?:${s})`).join("|"), "giu");
    } catch {
      return null;
    }
  }
}

export function Evidenziato({ testo, re }: { testo: string; re: RegExp | null }) {
  if (!re) return <>{testo}</>;
  const out: ReactNode[] = [];
  let ultimo = 0;
  const g = new RegExp(re.source, re.flags);
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = g.exec(testo)) && k < 400) {
    if (m[0].length === 0) {
      g.lastIndex++;
      continue;
    }
    if (m.index > ultimo) out.push(testo.slice(ultimo, m.index));
    out.push(<mark key={k++}>{m[0]}</mark>);
    ultimo = m.index + m[0].length;
  }
  if (ultimo < testo.length) out.push(testo.slice(ultimo));
  return <>{out}</>;
}

/* -------------------------------------------------------------------------- */
/* Chip di citazione                                                           */
/* -------------------------------------------------------------------------- */

export function ChipCitazione({
  n,
  fonte,
  onApri,
}: {
  n: number;
  fonte?: FonteStudio;
  onApri: (n: number, el: HTMLElement) => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => onApri(n, e.currentTarget)}
      title={fonte ? `${fonte.titolo}${fonte.anno !== "0000" ? ` (${fonte.anno})` : ""}` : `Fonte F${n}`}
      aria-label={`Apri la fonte F${n}${fonte ? `: ${fonte.titolo}` : ""}`}
      className="mx-[1px] inline-flex translate-y-[-1px] items-center rounded-[5px] border border-link/30 bg-link-soft/70 px-1 py-px align-baseline font-mono text-[10.5px] font-semibold leading-[15px] text-link-deep transition hover:border-link hover:bg-link hover:text-white focus:outline-none focus-visible:shadow-focus dark:border-link/40 dark:bg-[rgba(0,112,243,0.16)] dark:text-[#9ecbff] dark:hover:bg-link dark:hover:text-white print:border-0 print:bg-transparent print:p-0 print:text-ink"
    >
      F{n}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Markdown minimale e sicuro                                                  */
/* -------------------------------------------------------------------------- */

export interface ContestoTesto {
  fonti: Map<number, FonteStudio>;
  onApri: (n: number, el: HTMLElement) => void;
  /** Riferimenti normativi da marcare come "da verificare". */
  nonVerificati: string[];
}

const RE_INLINE = /(\*\*[^*\n]+\*\*|\[\s*F\s*\d+(?:\s*[,;]\s*(?:F\s*)?\d+)*\s*\]|\*[^*\n]+\*|_[^_\n]+_)/g;

function inline(testo: string, ctx: ContestoTesto, chiave: string): ReactNode[] {
  const parti = testo.split(RE_INLINE);
  return parti.map((p, i) => {
    const k = `${chiave}-${i}`;
    if (!p) return null;
    if (p.startsWith("**") && p.endsWith("**") && p.length > 4) {
      return (
        <strong key={k} className="font-semibold text-ink">
          {inline(p.slice(2, -2), ctx, k)}
        </strong>
      );
    }
    if (/^\[\s*F/i.test(p)) {
      const nums = (p.match(/\d+/g) ?? []).map(Number);
      return (
        <span key={k} className="whitespace-nowrap">
          {nums.map((n) => (
            <ChipCitazione key={`${k}-${n}`} n={n} fonte={ctx.fonti.get(n)} onApri={ctx.onApri} />
          ))}
        </span>
      );
    }
    if ((p.startsWith("*") && p.endsWith("*") && p.length > 2) || (p.startsWith("_") && p.endsWith("_") && p.length > 2)) {
      return (
        <em key={k} className="italic">
          {p.slice(1, -1)}
        </em>
      );
    }
    return <Fragment key={k}>{marcaNonVerificati(p, ctx.nonVerificati, k)}</Fragment>;
  });
}

function marcaNonVerificati(testo: string, lista: string[], chiave: string): ReactNode {
  if (!lista.length) return testo;
  const esc = lista.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).sort((a, b) => b.length - a.length);
  const re = new RegExp(`(${esc.join("|")})`, "gi");
  const parti = testo.split(re);
  if (parti.length === 1) return testo;
  return parti.map((p, i) =>
    i % 2 === 1 ? (
      <span
        key={`${chiave}-nv-${i}`}
        title="Riferimento non trovato negli estratti delle fonti: verificalo sul testo ufficiale."
        className="rounded-[3px] bg-[#f9cb2833] underline decoration-[#b45309] decoration-dotted underline-offset-4"
      >
        {p}
        <span aria-hidden className="ml-0.5 text-[10px] text-[#b45309]">⚠</span>
      </span>
    ) : (
      <Fragment key={`${chiave}-t-${i}`}>{p}</Fragment>
    )
  );
}

export function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

/**
 * Markdown -> React: paragrafi, ### sottotitoli, elenchi puntati e numerati,
 * citazioni, **grassetto**, *corsivo*. Tollerante al testo parziale dello
 * streaming (un "**" non chiuso resta testo).
 */
export function Markdown({ md, ctx, prefissoId }: { md: string; ctx: ContestoTesto; prefissoId: string }) {
  const righe = md.replace(/\r/g, "").split("\n");
  const blocchi: ReactNode[] = [];
  let paragrafo: string[] = [];
  let lista: { ordinata: boolean; voci: string[] } | null = null;
  let k = 0;

  const chiudiParagrafo = () => {
    if (!paragrafo.length) return;
    const testo = paragrafo.join(" ");
    blocchi.push(
      <p key={`p${k++}`} className="my-3 leading-[1.75]">
        {inline(testo, ctx, `p${k}`)}
      </p>
    );
    paragrafo = [];
  };
  const chiudiLista = () => {
    if (!lista) return;
    const Tag = lista.ordinata ? "ol" : "ul";
    blocchi.push(
      <Tag key={`l${k++}`} className={`my-3 space-y-1.5 pl-5 leading-[1.7] ${lista.ordinata ? "list-decimal" : "list-disc"} marker:text-mute`}>
        {lista.voci.map((v, i) => (
          <li key={i} className="pl-1">
            {inline(v, ctx, `l${k}-${i}`)}
          </li>
        ))}
      </Tag>
    );
    lista = null;
  };

  for (const grezza of righe) {
    const r = grezza.trimEnd();
    const titolo = r.match(/^#{1,6}\s+(.*)$/);
    const puntata = r.match(/^\s*[-*•]\s+(.*)$/);
    const numerata = r.match(/^\s*\d+[.)]\s+(.*)$/);
    if (!r.trim()) {
      chiudiParagrafo();
      chiudiLista();
    } else if (titolo) {
      chiudiParagrafo();
      chiudiLista();
      const testo = titolo[1].replace(/\*\*/g, "");
      blocchi.push(
        <h3 key={`h${k++}`} id={`${prefissoId}-${slug(testo)}`} className="mb-2 mt-7 scroll-mt-28 font-mono text-[12.5px] font-semibold uppercase tracking-[0.12em] text-ink">
          {testo}
        </h3>
      );
    } else if (puntata || numerata) {
      chiudiParagrafo();
      const ordinata = !!numerata;
      if (lista && lista.ordinata !== ordinata) chiudiLista();
      if (!lista) lista = { ordinata, voci: [] };
      lista.voci.push((puntata ?? numerata)![1]);
    } else if (lista && /^\s{2,}\S/.test(grezza)) {
      lista.voci[lista.voci.length - 1] += ` ${r.trim()}`;
    } else {
      chiudiLista();
      paragrafo.push(r.trim());
    }
  }
  chiudiParagrafo();
  chiudiLista();
  return <>{blocchi}</>;
}
