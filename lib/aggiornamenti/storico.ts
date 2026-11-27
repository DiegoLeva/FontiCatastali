import { decodificaEntita, parseData, parseElenco, parseNumero, testoDaHtml, urlCanonico, type FonteConfig, type VoceFonte } from "./fonti";

/**
 * Archivi storici dell'Agenzia delle Entrate (verificati il 27/11/2026 dalla
 * rete Vercel), tutti in HTML lato server, senza browser:
 *
 *   indice -> pagine per anno -> pagine per mese con i blocchi Liferay degli
 *   atti (stesso markup delle pagine principali: parseElenco);
 *   archivi dell'ex Agenzia del Territorio: pagine per anno con elenchi
 *   <li><a href="...pdf">Circolare n.3/2010</a><br> oggetto</li>.
 *
 * Funzioni PURE (nessuna rete): le usa lo script locale
 * scripts/importa-storico-ade.ts, che scarica e importa una tantum.
 */

const BASE = "https://www.agenziaentrate.gov.it";

export interface ArchivioAde {
  id: string;
  nome: string;
  indice: string;
  fonte: FonteConfig;
  /** true: l'indice elenca direttamente i PDF (niente pagine per anno). */
  diretto?: boolean;
}

const fonte = (id: string, nome: string, tipo: FonteConfig["tipo"], cartella: string, abbrev: string): FonteConfig => ({ id, nome, url: BASE, tipo, cartella, abbrev, minAttesi: 0 });

export const ARCHIVI_ADE: ArchivioAde[] = [
  {
    id: "circolari",
    nome: "Circolari (dal 2006)",
    indice: `${BASE}/portale/web/guest/normativa-e-prassi/circolari/archivio-circolari`,
    fonte: fonte("ade-storico-circolari", "Agenzia delle Entrate · Archivio circolari", "circolare", "02 - Circolari", "Circ."),
  },
  {
    id: "risoluzioni",
    nome: "Risoluzioni",
    indice: `${BASE}/portale/web/guest/normativa-e-prassi/risoluzioni/archivio-risoluzioni`,
    fonte: fonte("ade-storico-risoluzioni", "Agenzia delle Entrate · Archivio risoluzioni", "risoluzione", "20 - Risoluzioni", "Ris."),
  },
  {
    id: "provvedimenti",
    nome: "Provvedimenti soggetti a pubblicità legale",
    indice: `${BASE}/portale/web/guest/archivio/normativa-prassi-archivio-documentazione/provvedimenti/provvedimenti-soggetti`,
    fonte: fonte("ade-storico-provvedimenti", "Agenzia delle Entrate · Archivio provvedimenti", "provvedimento", "19 - Provvedimenti", "Prov."),
  },
  {
    id: "territorio-circolari",
    nome: "Circolari dell'ex Agenzia del Territorio (2001-2012)",
    indice: `${BASE}/portale/web/guest/archivio/normativa-prassi-archivio-documentazione/circolari-territorio`,
    fonte: fonte("ade-storico-territorio-circolari", "Ex Agenzia del Territorio · Circolari", "circolare", "02 - Circolari", "Circ."),
  },
  {
    id: "territorio-risoluzioni",
    nome: "Risoluzioni dell'ex Agenzia del Territorio",
    indice: `${BASE}/portale/web/guest/archivio/normativa-prassi-archivio-documentazione/risoluzioni-territorio`,
    fonte: fonte("ade-storico-territorio-risoluzioni", "Ex Agenzia del Territorio · Risoluzioni", "risoluzione", "20 - Risoluzioni", "Ris."),
    diretto: true,
  },
];

const assoluto = (href: string) => {
  try {
    return new URL(decodificaEntita(href), BASE).toString();
  } catch {
    return null;
  }
};

const ancore = (html: string) =>
  [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => ({ href: m[1], testo: testoDaHtml(m[2]) }));

const stessoSito = (u: string) => /^https?:\/\/(?:www\.)?agenziaentrate\.gov\.it\//i.test(u);

/** Pagine per anno dell'indice ("Le circolari del 2025", "Archivio 2010", "2025 - Provvedimenti ..."). */
export function linkAnni(html: string): Array<{ url: string; anno: number; testo: string }> {
  const out = new Map<string, { url: string; anno: number; testo: string }>();
  for (const a of ancore(html)) {
    const m = a.testo.match(/^(?:le\s+\w+\s+del\s+|archivio\s+|anno\s+)?((?:19|20)\d{2})\b|\bdel\s+((?:19|20)\d{2})$/i);
    const anno = Number(m?.[1] ?? m?.[2]);
    const url = assoluto(a.href);
    if (!anno || !url || !stessoSito(url) || /\.pdf(?:$|[?#])/i.test(url) || a.testo.length > 90) continue;
    if (!out.has(url)) out.set(url, { url, anno, testo: a.testo });
  }
  return [...out.values()];
}

const MESI = "gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre";

/** Pagine per mese di un anno ("Dicembre 2025 (dalla n° 13 alla n° 15)"). */
export function linkMesi(html: string): Array<{ url: string; testo: string }> {
  const out = new Map<string, { url: string; testo: string }>();
  for (const a of ancore(html)) {
    if (!new RegExp(`^(?:${MESI})\\s+(?:19|20)\\d{2}\\b`, "i").test(a.testo)) continue;
    const url = assoluto(a.href);
    if (url && stessoSito(url) && !out.has(url)) out.set(url, { url, testo: a.testo });
  }
  return [...out.values()];
}

/**
 * Elenchi semplici dell'ex Agenzia del Territorio:
 *   <li><a href="...pdf">Circolare n.3/2010 </a><br> Interpretazione ... - Aggiornamento del catasto.</li>
 */
export function vociListaSemplice(html: string, f: FonteConfig): VoceFonte[] {
  const out: VoceFonte[] = [];
  const visti = new Set<string>();
  for (const li of html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const a = li[1].match(/<a\b[^>]*href="([^"]+\.pdf[^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const titoloFonte = testoDaHtml(a[2]);
    if (!titoloFonte || /^allegat/i.test(titoloFonte)) continue;
    const href = decodificaEntita(a[1]);
    const { url, download } = /\/portale\/documents\//i.test(href) ? urlCanonico(href) : { url: assoluto(href) ?? href, download: assoluto(href) ?? href };
    if (visti.has(url)) continue;
    visti.add(url);
    const oggetto = testoDaHtml(li[1].replace(a[0], " ")).replace(/^[\s–-]+/, "");
    const data = parseData(titoloFonte) ?? parseData(oggetto);
    const numero = parseNumero(titoloFonte) ?? titoloFonte.match(/n\.?\s*°?\s*(\d+)\s*\//i)?.[1] ?? null;
    const anno = Number(titoloFonte.match(/\/\s*((?:19|20)\d{2})\b/)?.[1] ?? data?.slice(0, 4)) || null;
    if (!numero && !data) continue;
    out.push({ fonte: f.id, tipo: f.tipo, url, urlDownload: download, titoloFonte, oggetto, numero, data, anno });
  }
  return out;
}

/** Tutte le voci di una pagina d'archivio (blocchi Liferay o elenchi semplici). */
export function vociPagina(html: string, f: FonteConfig): VoceFonte[] {
  const perUrl = new Map<string, VoceFonte>();
  for (const v of [...parseElenco(html, f), ...vociListaSemplice(html, f)]) if (!perUrl.has(v.url)) perUrl.set(v.url, v);
  return [...perUrl.values()];
}
