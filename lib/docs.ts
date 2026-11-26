/**
 * Helper condivisi sui documenti del corpus: URL del file e anno formattato.
 *
 * Prima ogni route aveva la sua copia di queste due funzioni; ora vivono qui,
 * cosi' la regola degli URL esterni (sotto) vale ovunque nello stesso modo.
 */

const DOCS_BASE_URL = process.env.NEXT_PUBLIC_DOCS_BASE_URL || "/docs";

/**
 * URL del documento originale.
 *
 * I documenti del corpus storico stanno sul bucket (`<base>/<cartella>/<file>`).
 * Quelli importati dall'aggiornamento automatico invece non hanno una copia sul
 * bucket (Vercel non ne possiede le credenziali di scrittura): per loro
 * `nuovo_nome_file` contiene direttamente l'URL ufficiale del PDF sul sito
 * dell'Agenzia, che e' anche la fonte piu' autorevole. Si riconoscono dallo
 * schema http(s).
 */
export function docUrl(cartella: string, nomeFile: string): string {
  if (/^https?:\/\//i.test(nomeFile)) return nomeFile;
  return `${DOCS_BASE_URL}/${encodeURIComponent(cartella)}/${encodeURIComponent(
    nomeFile
  )}`;
}

/** Anno a 4 cifre, oppure "0000" se assente (convenzione del corpus). */
export function fmtAnno(anno: unknown): string {
  const n = typeof anno === "bigint" ? Number(anno) : Number(anno ?? 0);
  return n > 0 ? String(n).padStart(4, "0") : "0000";
}

/** True se il documento e' stato importato dall'aggiornamento automatico. */
export function isImportatoWeb(nomeFile: string): boolean {
  return /^https?:\/\//i.test(nomeFile);
}
