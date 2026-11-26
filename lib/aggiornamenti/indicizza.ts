import { CloudflareError, d1Query, embedMany, vectorUpsert } from "@/lib/cloudflare";
import { spazioPerNuoviVettori } from "@/lib/ai/vectorize";

/**
 * Indicizzazione semantica (Normie: Vectorize + D1) degli atti importati.
 *
 * E' "best effort": il corpus su Turso (ricerca, mappa, Studio) e' gia'
 * aggiornato quando si arriva qui. Se il token Cloudflare non ha i permessi
 * di scrittura (Vectorize Edit, D1 Edit) l'errore viene registrato sulla voce
 * e il passaggio ritentato alle esecuzioni successive: basta aggiornare il
 * token e il lunedi' dopo gli atti arretrati vengono indicizzati da soli.
 *
 * Il chunking e' la stessa logica di scripts/ingest_normie.py (unita'
 * normative intere: commi, lettere, elenchi; overlap a unita' intere), cosi'
 * gli atti nuovi si comportano come quelli caricati dalla pipeline.
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

export interface DocDaIndicizzare {
  docId: number;
  titolo: string;
  cartella: string;
  nomeFile: string;
  anno: number;
  testo: string;
}

/** Restituisce "ok" oppure un messaggio di errore leggibile (mai un'eccezione). */
export async function indicizzaSemantico(d: DocDaIndicizzare): Promise<string> {
  if (!process.env.CF_ACCOUNT_ID || !process.env.CF_API_TOKEN || !process.env.CF_VECTORIZE_INDEX || !process.env.CF_D1_DATABASE_ID) {
    return "errore: credenziali Cloudflare non configurate";
  }
  const pezzi = chunkTesto(d.testo);
  if (!pezzi.length) return "errore: testo vuoto";
  // Quote Vectorize: nuovi vettori solo se le dimensioni memorizzate restano
  // sotto quelle incluse nel piano (altrimenti si rimanda, senza costi).
  const spazio = await spazioPerNuoviVettori(pezzi.length);
  if (!spazio.ok) return `rimandata: ${spazio.motivo}`;
  try {
    // 1) testo su D1 per primo: e' la fonte autoritativa letta da Normie.
    for (let i = 0; i < pezzi.length; i += D1_BATCH) {
      const lotto = pezzi.slice(i, i + D1_BATCH);
      const params: unknown[] = [];
      lotto.forEach((testo, j) => {
        const idx = i + j;
        params.push(`${d.docId}-${idx}`, d.docId, d.titolo, d.cartella, d.nomeFile, d.anno, idx, testo);
      });
      await d1Query(
        `INSERT OR REPLACE INTO chunks (id, doc_id, titolo, cartella, nome_file, anno, chunk_index, testo)
         VALUES ${lotto.map(() => "(?,?,?,?,?,?,?,?)").join(",")}`,
        params
      );
    }
    // 2) embedding + upsert su Vectorize (metadati leggeri, testo in D1).
    for (let i = 0; i < pezzi.length; i += EMBED_BATCH) {
      const lotto = pezzi.slice(i, i + EMBED_BATCH);
      const vettori = await embedMany(lotto);
      await vectorUpsert(
        vettori.map((values, j) => ({
          id: `${d.docId}-${i + j}`,
          values,
          metadata: {
            docId: d.docId,
            titolo: d.titolo,
            cartella: d.cartella,
            nomeFile: d.nomeFile,
            anno: d.anno,
            chunkIndex: i + j,
          },
        }))
      );
    }
    return "ok";
  } catch (err) {
    const msg = (err as Error).message || "errore sconosciuto";
    if (err instanceof CloudflareError && (err.status === 401 || err.status === 403)) {
      return "errore: il token Cloudflare non ha i permessi di scrittura su D1/Vectorize";
    }
    return `errore: ${msg.slice(0, 200)}`;
  }
}
