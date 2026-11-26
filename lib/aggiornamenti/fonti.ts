/**
 * Fonti monitorate dall'aggiornamento automatico e parser delle loro pagine.
 *
 * Verificato il 26/11/2026 dalla rete Vercel (iad1): le pagine "Normativa e
 * prassi" dell'Agenzia delle Entrate rispondono 200 senza challenge anti-bot e
 * contengono nell'HTML server-side gli atti piu' recenti (10 circolari, 10
 * risoluzioni, ~20 provvedimenti), ciascuno in un blocco Liferay:
 *
 *   <div class="journal-content-article " ...
 *        data-analytics-asset-title="Circolare n. 9 del 21 ottobre 2026" ...>
 *     <p><strong>Circolare n. 9 del 21/10/2026 </strong></p>
 *     <p><a href="https://www.agenziaentrate.gov.it/portale/documents/20143/
 *        10360006/Circolare+n.+9+del+21+ottobre+2026.pdf/cfb98eb0-...?t=...">
 *        Decreto legislativo 12 gennaio 2019, n. 14 ... (oggetto)</a></p>
 *
 * Gli archivi annuali (/portale/circolari-2026) sono invece renderizzati via
 * JavaScript: inutilizzabili senza browser. Per un controllo settimanale le
 * pagine principali bastano (escono pochi atti a settimana).
 *
 * Se l'Agenzia cambia il markup il parser trova zero voci: `minAttesi` rende
 * il guasto VISIBILE (esito "parziale" con messaggio esplicito) invece di
 * un silenzioso "nessuna novita'".
 */

export type TipoAtto = "circolare" | "risoluzione" | "provvedimento";

export interface FonteConfig {
  id: string;
  nome: string;
  url: string;
  tipo: TipoAtto;
  /** Cartella del corpus in cui finiscono gli atti importati. */
  cartella: string;
  /** Abbreviazione usata nei titoli del corpus ("Circ. 27 - ..."). */
  abbrev: string;
  /** Sotto questa soglia di voci lette la pagina e' considerata cambiata. */
  minAttesi: number;
}

const BASE = "https://www.agenziaentrate.gov.it";

export const FONTI: FonteConfig[] = [
  {
    id: "ade-circolari",
    nome: "Agenzia delle Entrate · Circolari",
    url: `${BASE}/portale/normativa-e-prassi/circolari`,
    tipo: "circolare",
    cartella: "02 - Circolari",
    abbrev: "Circ.",
    minAttesi: 3,
  },
  {
    id: "ade-risoluzioni",
    nome: "Agenzia delle Entrate · Risoluzioni",
    url: `${BASE}/portale/normativa-e-prassi/risoluzioni`,
    tipo: "risoluzione",
    cartella: "20 - Risoluzioni",
    abbrev: "Ris.",
    minAttesi: 3,
  },
  {
    id: "ade-provvedimenti",
    nome: "Agenzia delle Entrate · Provvedimenti (pubblicità legale)",
    url: `${BASE}/portale/normativa-e-prassi/provvedimenti`,
    tipo: "provvedimento",
    cartella: "19 - Provvedimenti",
    abbrev: "Prov.",
    minAttesi: 3,
  },
  {
    id: "ade-provvedimenti-altri",
    nome: "Agenzia delle Entrate · Altri provvedimenti",
    url: `${BASE}/portale/normativa-e-prassi/altri-provvedimenti-non-soggetti-attuale`,
    tipo: "provvedimento",
    cartella: "19 - Provvedimenti",
    abbrev: "Prov.",
    minAttesi: 2,
  },
];

export interface VoceFonte {
  fonte: string;
  tipo: TipoAtto;
  /** URL del PDF senza query string: chiave stabile di deduplica. */
  url: string;
  /** URL completo (con `?t=` di cache-busting) usato per il download. */
  urlDownload: string;
  titoloFonte: string;
  oggetto: string;
  numero: string | null;
  /** Data ISO "AAAA-MM-GG" se ricavabile. */
  data: string | null;
  anno: number | null;
}

/* -------------------------------------------------------------------------- */
/* Decodifica e normalizzazione                                               */
/* -------------------------------------------------------------------------- */

const ENTITA: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  agrave: "à", egrave: "è", eacute: "é", igrave: "ì", ograve: "ò", ugrave: "ù",
  Agrave: "À", Egrave: "È", Eacute: "É", Igrave: "Ì", Ograve: "Ò", Ugrave: "Ù",
  rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»",
  ndash: "–", mdash: "—", hellip: "…", deg: "°", euro: "€", ordm: "º", ordf: "ª",
};

/** Decodifica le entita' HTML (anche doppie, es. `&amp;agrave;`). */
export function decodificaEntita(s: string): string {
  let out = s;
  for (let i = 0; i < 2; i++) {
    const prima = out;
    out = out
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&([a-z]+);/gi, (m, nome) => ENTITA[nome] ?? m);
    if (out === prima) break;
  }
  return out;
}

/** Testo visibile di un frammento HTML. */
export function testoDaHtml(html: string): string {
  return decodificaEntita(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

const MESI: Record<string, number> = {
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6,
  luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
};

/** "21 ottobre 2026" | "21/10/2026" | "21.10.2026" -> "2026-10-21". */
export function parseData(s: string): string | null {
  const m = s.match(
    /\b(\d{1,2})\s*[/.\-\s]\s*(\d{1,2}|gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s*[/.\-\s]\s*(\d{4})\b/i
  );
  if (!m) return null;
  const g = Number(m[1]);
  const mese = /^\d+$/.test(m[2]) ? Number(m[2]) : MESI[m[2].toLowerCase()];
  const a = Number(m[3]);
  if (!mese || g < 1 || g > 31 || mese > 12 || a < 1900 || a > 2100) return null;
  return `${a}-${String(mese).padStart(2, "0")}-${String(g).padStart(2, "0")}`;
}

/** Numero dell'atto dal titolo: "Circolare n. 9 del ..." -> "9". */
export function parseNumero(s: string): string | null {
  const m = s.match(/\bn(?:\.|°|um(?:ero)?\.?)\s*(\d{1,6})(?:\s*\/\s*E)?\b/i);
  return m ? String(Number(m[1])) : null;
}

/** URL assoluto e senza query string (il `?t=` cambia a ogni ripubblicazione). */
export function urlCanonico(href: string): { url: string; download: string } {
  const pulito = decodificaEntita(href.trim());
  const assoluto = pulito.startsWith("http") ? pulito : `${BASE}${pulito.startsWith("/") ? "" : "/"}${pulito}`;
  try {
    const u = new URL(assoluto);
    const download = u.toString();
    u.search = "";
    u.hash = "";
    return { url: u.toString(), download };
  } catch {
    return { url: assoluto.split("?")[0], download: assoluto };
  }
}

/* -------------------------------------------------------------------------- */
/* Parser dell'elenco                                                          */
/* -------------------------------------------------------------------------- */

const RE_ANCORA = /<a\b[^>]*?href\s*=\s*"([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

/**
 * Estrae gli atti da una pagina elenco dell'Agenzia. Pura e senza rete: si
 * testa con l'HTML salvato. Un blocco senza numero ne' data (es.
 * l'intestazione "Ultimi provvedimenti del Direttore...") viene scartato.
 */
export function parseElenco(html: string, fonte: FonteConfig): VoceFonte[] {
  const blocchi = html.split(/class="journal-content-article\b/).slice(1);
  const voci: VoceFonte[] = [];
  const visti = new Set<string>();

  for (const grezzo of blocchi) {
    const blocco = grezzo.slice(0, 12000);
    const titoloAttr = decodificaEntita(
      (blocco.match(/data-analytics-asset-title="([^"]*)"/) || [])[1] || ""
    ).trim();
    const strong = testoDaHtml((blocco.match(/<strong>([\s\S]*?)<\/strong>/i) || [])[1] || "");

    // Primo link a un documento che non sia un allegato.
    let principale: { href: string; testo: string } | null = null;
    RE_ANCORA.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = RE_ANCORA.exec(blocco))) {
      const href = m[1];
      if (!/\/portale\/documents\//i.test(href)) continue;
      const testo = testoDaHtml(m[2]);
      if (/^allegat/i.test(testo)) continue;
      principale = { href, testo };
      break;
    }
    if (!principale) continue;

    const estremi = [titoloAttr, strong].filter(Boolean).join(" · ");
    const data = parseData(titoloAttr) ?? parseData(strong);
    const numero = fonte.tipo === "provvedimento" ? null : parseNumero(titoloAttr) ?? parseNumero(strong);
    if (!data && !numero) continue;

    const { url, download } = urlCanonico(principale.href);
    if (visti.has(url)) continue;
    visti.add(url);

    voci.push({
      fonte: fonte.id,
      tipo: fonte.tipo,
      url,
      urlDownload: download,
      titoloFonte: estremi || principale.testo,
      oggetto: principale.testo,
      numero,
      data,
      anno: data ? Number(data.slice(0, 4)) : null,
    });
  }
  return voci;
}

/* -------------------------------------------------------------------------- */
/* Download dell'elenco                                                        */
/* -------------------------------------------------------------------------- */

export const USER_AGENT =
  "Mozilla/5.0 (compatible; FontiCatastali-Aggiornamenti/1.0; +https://fonti-catastali.vercel.app/aggiornamenti)";

export interface EsitoFetchElenco {
  ok: boolean;
  status: number | null;
  html: string;
  errore?: string;
}

/** GET con timeout e un nuovo tentativo sugli errori transitori. */
export async function scaricaElenco(url: string, timeoutMs = 20000): Promise<EsitoFetchElenco> {
  let ultimo: EsitoFetchElenco = { ok: false, status: null, html: "", errore: "non eseguito" };
  for (let tentativo = 0; tentativo < 2; tentativo++) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
        redirect: "follow",
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
      const html = await res.text();
      if (res.ok) {
        // Una pagina "challenge" anti-bot risponde 200 ma senza i blocchi.
        if (!/journal-content-article/.test(html) && /captcha|challenge|access denied/i.test(html)) {
          return { ok: false, status: res.status, html: "", errore: "pagina di verifica anti-bot" };
        }
        return { ok: true, status: res.status, html };
      }
      ultimo = { ok: false, status: res.status, html: "", errore: `HTTP ${res.status}` };
      if (![408, 425, 429, 500, 502, 503, 504].includes(res.status)) return ultimo;
    } catch (err) {
      ultimo = { ok: false, status: null, html: "", errore: (err as Error).message || "errore di rete" };
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return ultimo;
}
