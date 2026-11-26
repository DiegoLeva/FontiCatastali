import { createHash } from "node:crypto";
import { USER_AGENT } from "./fonti";

/**
 * Download di un PDF ed estrazione del testo con unpdf (pdf.js in build
 * serverless, senza worker ne' canvas).
 *
 * Verificato in sandbox sui PDF dell'Agenzia: testo nativo (non scansioni),
 * 4-7 pagine estratte in ~1 s. Due dettagli che contano:
 *  - pdf.js "stacca" (transfer) il buffer che riceve: l'impronta SHA-256 va
 *    calcolata PRIMA dell'estrazione, e a pdf.js si passa una copia;
 *  - i warning sui font ("TT: undefined function") si silenziano con
 *    verbosity 0: sono innocui ma sporcano i log.
 */

const MAX_BYTES = 25 * 1024 * 1024;
const MIN_TESTO = 200;

export interface PdfEstratto {
  sha256: string;
  byte: number;
  pagine: number;
  testo: string;
}

export class ErrorePdf extends Error {
  constructor(
    message: string,
    /** false = inutile ritentare (es. PDF senza testo). */
    readonly ritentabile: boolean
  ) {
    super(message);
  }
}

export async function scaricaPdf(url: string, timeoutMs = 45000): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "application/pdf,*/*;q=0.8" },
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new ErrorePdf(`download non riuscito: ${(err as Error).message}`, true);
  }
  if (!res.ok) throw new ErrorePdf(`download non riuscito: HTTP ${res.status}`, res.status >= 500 || res.status === 429);
  const dichiarati = Number(res.headers.get("content-length") || 0);
  if (dichiarati > MAX_BYTES) throw new ErrorePdf(`PDF troppo grande (${Math.round(dichiarati / 1048576)} MB)`, false);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new ErrorePdf(`PDF troppo grande (${Math.round(buf.length / 1048576)} MB)`, false);
  // Firma %PDF- : un HTML di errore servito con 200 non deve passare per PDF.
  if (!(buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46)) {
    throw new ErrorePdf("il file scaricato non e' un PDF", false);
  }
  return buf;
}

/** Ripulisce il testo estratto: spazi, trattini di a capo, righe vuote. */
export function pulisciTesto(pagine: string[]): string {
  return pagine
    .map((p) =>
      p
        .replace(/\u0000/g, "")
        .replace(/[ \t\f\v]+/g, " ")
        .replace(/(\p{L})-\n(\p{L})/gu, "$1$2")
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
    )
    .filter(Boolean)
    .join("\n\n");
}

export async function estraiTesto(buf: Uint8Array): Promise<PdfEstratto> {
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const byte = buf.length;
  const { extractText, getDocumentProxy } = await import("unpdf");
  let pagine: string[];
  let totale: number;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buf), { verbosity: 0 });
    const out = await extractText(pdf, { mergePages: false });
    totale = out.totalPages;
    pagine = Array.isArray(out.text) ? out.text : [String(out.text)];
  } catch (err) {
    throw new ErrorePdf(`estrazione del testo non riuscita: ${(err as Error).message}`, false);
  }
  const testo = pulisciTesto(pagine);
  if (testo.replace(/\s/g, "").length < MIN_TESTO) {
    throw new ErrorePdf("PDF senza testo selezionabile (probabile scansione): serve OCR", false);
  }
  return { sha256, byte, pagine: totale, testo };
}

/** Protocollo dei provvedimenti: "Prot. n. 362641/2026" -> {numero, anno}. */
export function estraiProtocollo(testo: string): { numero: string; anno: number } | null {
  const testa = testo.slice(0, 1500).replace(/\s+/g, " ");
  const m = testa.match(/\bprot(?:\.|ocollo)?\s*(?:n\.?|n°)?\s*(\d{3,7})\s*\/\s*(\d{4})\b/i);
  if (!m) return null;
  const anno = Number(m[2]);
  if (anno < 1990 || anno > 2100) return null;
  return { numero: String(Number(m[1])), anno };
}
