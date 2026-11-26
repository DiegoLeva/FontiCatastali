/**
 * Rate limiting in memoria a finestra scorrevole.
 *
 * E' "best effort": vale per istanza della funzione. Con Fluid Compute le
 * istanze vengono riusate e servono molte richieste in parallelo, quindi
 * ferma gia' gli abusi ripetuti dallo stesso client (refresh compulsivi,
 * script) senza introdurre un servizio esterno. Per le operazioni costose
 * (generazione dei dossier) si affianca un tetto giornaliero globale su Turso.
 */

const buckets = new Map<string, number[]>();
const MAX_KEYS = 5000;

export interface RateLimitResult {
  ok: boolean;
  /** Secondi dopo cui riprovare (0 se ok). */
  retryAfter: number;
  remaining: number;
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const recenti = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);

  if (recenti.length >= limit) {
    buckets.set(key, recenti);
    const retryAfter = Math.max(
      1,
      Math.ceil((windowMs - (now - recenti[0])) / 1000)
    );
    return { ok: false, retryAfter, remaining: 0 };
  }

  recenti.push(now);
  buckets.set(key, recenti);

  // Pulizia periodica: niente crescita illimitata della mappa.
  if (buckets.size > MAX_KEYS) {
    for (const [k, v] of buckets) {
      if (v.length === 0 || now - v[v.length - 1] > windowMs) buckets.delete(k);
    }
  }

  return { ok: true, retryAfter: 0, remaining: limit - recenti.length };
}
