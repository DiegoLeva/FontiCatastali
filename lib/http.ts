/**
 * Utility HTTP lato server: politiche di cache CDN e IP del client.
 *
 * Su Vercel una risposta di funzione con `s-maxage` viene messa in cache dalla
 * CDN (per regione) e servita senza invocare di nuovo la funzione; il browser
 * non vede `s-maxage`. `stale-while-revalidate` permette di servire la copia
 * vecchia mentre se ne prepara una nuova in background: l'utente non aspetta
 * mai il database.
 */

/** Dati che cambiano solo con un import o un deploy (catalogo, argomenti). */
export const CACHE_CDN_LUNGA =
  "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400";

/** Risultati di ricerca: identici per la stessa query finche' il DB non cambia. */
export const CACHE_CDN_BREVE =
  "public, max-age=0, s-maxage=600, stale-while-revalidate=86400";

/** Stato aggiornamenti e liste "recenti": freschi ma non a ogni richiesta. */
export const CACHE_CDN_MINUTO =
  "public, max-age=0, s-maxage=60, stale-while-revalidate=600";

export const NO_STORE = "no-store";

/** IP del client dietro al proxy di Vercel (primo hop di x-forwarded-for). */
export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim() || "sconosciuto";
  return req.headers.get("x-real-ip") || "sconosciuto";
}
