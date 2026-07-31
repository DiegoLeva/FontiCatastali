/**
 * Utility FTS5: costruzione query MATCH sicura + sanificazione dello snippet.
 *
 * Marcatori dello snippet: due caratteri Private-Use-Area (U+E000/U+E001) che
 * non compaiono mai nel testo reale e non sono caratteri speciali HTML. Cosi'
 * possiamo prima ESCAPARE tutto l'HTML (anti-XSS) e poi sostituire i marcatori
 * con <mark>/</mark>: l'unico HTML iniettato e' il tag <mark> controllato da noi.
 */
export const MARK_START = String.fromCharCode(0xe000);
export const MARK_END = String.fromCharCode(0xe001);

/**
 * Trasforma il testo libero dell'utente in una query FTS5 valida e sicura.
 * - toglie accenti (l'indice usa `remove_diacritics 2`, quindi combaciano)
 * - tiene solo lettere/numeri -> nessun carattere di sintassi FTS residuo
 * - ogni token diventa prefisso (`token*`) per una ricerca "as-you-type"
 * - token uniti con AND implicito (tutti devono comparire)
 * Ritorna "" se non resta nulla di ricercabile.
 */
export function buildMatchQuery(raw: string): string {
  const tokens = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "") // rimuove i segni diacritici combinanti
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);

  if (tokens.length === 0) return "";
  return tokens.map((t) => `${t}*`).join(" ");
}

const HTML_ESCAPE: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (c) => HTML_ESCAPE[c]);
}

/**
 * Converte lo snippet grezzo (con marcatori PUA) in HTML sicuro:
 * escape completo + sostituzione marcatori con <mark>.
 */
export function snippetToSafeHtml(raw: string): string {
  return escapeHtml(raw)
    .split(MARK_START)
    .join("<mark>")
    .split(MARK_END)
    .join("</mark>");
}

/**
 * RICERCA ESATTA: dato un frammento di testo e la query letterale, restituisce
 * HTML sicuro con OGNI occorrenza esatta (case-insensitive, spazi inclusi)
 * avvolta in <mark>. Tutto il resto e' HTML-escapato.
 */
export function exactSnippetHtml(window: string, query: string): string {
  const text = window.replace(/\s+/g, " ").trim();
  if (!text) return "";
  const q = query.trim();
  if (!q) return escapeHtml(text);
  const lc = text.toLowerCase();
  const ql = q.toLowerCase();
  let out = "";
  let i = 0;
  while (true) {
    const idx = lc.indexOf(ql, i);
    if (idx < 0) {
      out += escapeHtml(text.slice(i));
      break;
    }
    out +=
      escapeHtml(text.slice(i, idx)) +
      "<mark>" +
      escapeHtml(text.slice(idx, idx + ql.length)) +
      "</mark>";
    i = idx + ql.length;
  }
  return out;
}
