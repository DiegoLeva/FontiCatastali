import type { Client } from "@libsql/client";
import { indicizzaDocumenti, type EsitoIndice } from "@/lib/ai/indice";

/**
 * Indicizzazione semantica degli atti importati dal cron.
 *
 * E' "best effort": il corpus su Turso (ricerca, mappa, Studio) e' gia'
 * aggiornato quando si arriva qui. Il lavoro vero lo fa lib/ai/indice.ts
 * (passaggi con offset su Turso, EmbeddingGemma-2, tetti di neuroni e di
 * dimensioni): se il tempo o il budget finiscono, gli atti restano in coda e
 * li riprende il cron giornaliero /api/cron/giornaliero.
 *
 * `chunkTesto` resta per compatibilita' (stessa logica di
 * scripts/ingest_normie.py, unita' normative intere con overlap).
 */

const CHUNK_CHARS = 1400;
const CHUNK_OVERLAP = 200;
const EMBED_BATCH = 20;
const D1_BATCH = 10; // 10 righe x 8 colonne = 80 parametri (limite D1: 100)

const UNIT_START =
  /^(?:\d{1,3}[.)]\s|[a-zA-Z][)]\s|[a-zA-Z]-?bis[).]\s|[-–—•·*▪]\s|art(?:\.|icolo)\s*\d|comma\s+\d|capo\s+[IVXLC0-9]|titolo\s+[IVXLC0-9])/i;
const SENT_END = /(?<=[.;:])\s+(?=\S)/;

function segmentaUnita(testo: string): string[] {
  const unita: string[] = [];
  let cur = "";
  for (const grezza of testo.split(/\r?\n/)) {
    const riga = grezza.replace(/[ \t]+/g, " ").trim();
    if (!riga) {
      if (cur) unita.push(cur);
      cur = "";
      continue;
    }
    if (UNIT_START.test(riga) && cur) {
      unita.push(cur);
      cur = riga;
    } else {
      cur = cur ? `${cur} ${riga}` : riga;
    }
  }
  if (cur) unita.push(cur);
  return unita.map((u) => u.trim()).filter(Boolean);
}

function spezzaLunghe(u: string): string[] {
  if (u.length <= CHUNK_CHARS) return [u];
  const out: string[] = [];
  let buf = "";
  for (const frase of u.split(SENT_END)) {
    if (frase.length > CHUNK_CHARS) {
      if (buf) out.push(buf);
      buf = "";
      let riga = "";
      for (const parola of frase.split(" ")) {
        if (riga && riga.length + parola.length + 1 > CHUNK_CHARS) {
          out.push(riga);
          riga = parola;
        } else riga = `${riga} ${parola}`.trim();
      }
      buf = riga;
    } else if (buf && buf.length + frase.length + 1 > CHUNK_CHARS) {
      out.push(buf);
      buf = frase;
    } else buf = `${buf} ${frase}`.trim();
  }
  if (buf) out.push(buf);
  return out;
}

function prefissoOverlap(prec: string[]): string[] {
  const coda: string[] = [];
  let l = 0;
  for (let i = prec.length - 1; i >= 0; i--) {
    const u = prec[i];
    if (u.length > CHUNK_OVERLAP) break;
    if (coda.length && l + u.length > CHUNK_OVERLAP) break;
    coda.unshift(u);
    l += u.length + 1;
  }
  return coda;
}

export function chunkTesto(testo: string): string[] {
  const atomi = segmentaUnita(testo).flatMap(spezzaLunghe);
  if (!atomi.length) return [];
  const base: string[][] = [];
  let cur: string[] = [];
  let len = 0;
  for (const a of atomi) {
    const add = a.length + (cur.length ? 1 : 0);
    if (cur.length && len + add > CHUNK_CHARS) {
      base.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(a);
    len += cur.length === 1 ? a.length : add;
  }
  if (cur.length) base.push(cur);
  return base
    .map((u, i) => [...(i > 0 ? prefissoOverlap(base[i - 1]) : []), ...u].join(" ").trim())
    .filter(Boolean);
}

/**
 * Indicizza prima gli atti appena importati, poi (col tempo che resta) i
 * documenti ancora mancanti dall'indice. Aggiorna lo stato "semantico" delle
 * voci del registro.
 */
export async function indicizzaImportati(db: Client, idImportati: number[], budgetMs: number): Promise<EsitoIndice> {
  const t0 = Date.now();
  let esito = await indicizzaDocumenti(db, { soloIds: idImportati.length ? idImportati : undefined, budgetMs });
  if (idImportati.length && !esito.arresto && Date.now() - t0 < budgetMs - 5_000) {
    const resto = await indicizzaDocumenti(db, { budgetMs: budgetMs - (Date.now() - t0) });
    esito = { ...resto, documenti: esito.documenti + resto.documenti, vettori: esito.vettori + resto.vettori, neuroni: esito.neuroni + resto.neuroni };
  }
  try {
    await db.execute(
      `UPDATE aggiornamenti_voci SET semantico = 'ok'
       WHERE stato = 'importato' AND doc_id IN (SELECT doc_id FROM vectorize_documenti) AND (semantico IS NULL OR semantico <> 'ok')`
    );
    if (esito.arresto) {
      await db.execute({
        sql: `UPDATE aggiornamenti_voci SET semantico = ?
              WHERE stato = 'importato' AND doc_id IS NOT NULL AND doc_id NOT IN (SELECT doc_id FROM vectorize_documenti)`,
        args: [`rimandata: ${esito.arresto}`.slice(0, 300)],
      });
    }
  } catch {
    /* registro del cron non ancora creato */
  }
  return esito;
}
