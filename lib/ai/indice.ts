import type { Client } from "@libsql/client";
import {
  CloudflareError,
  EMBEDDING_DIMS,
  EMBEDDING_MODEL,
  embedMany,
  quotaEsaurita,
  testoPerEmbedding,
  vectorDeleteByIds,
  vectorUpsert,
  type VettoreUpsert,
} from "@/lib/cloudflare";
import { BudgetAiEsaurito, conServizioAi, giornoUtc, MARGINE, neuroni, stimaToken, type TettoLocale } from "@/lib/ai/budget";
import { generazioneCorrente, leggiInfo, TETTO_MEMORIZZATE, ultimoErroreInfo } from "@/lib/ai/vectorize";
import {
  assicuraSchemaIndice,
  invalidaRiepilogo,
  ritaglio,
  selezionaPassaggi,
  spezzaInPassaggi,
  stimaPassaggi,
  tettoPerDocumento,
  type Passaggio,
} from "@/lib/ai/passaggi";
import { haMetadati } from "@/lib/metadati/bonifica";

/**
 * Indicizzazione semantica del corpus (Normie, Studio, ricerca ibrida).
 *
 * Idempotente e a lotti: ogni documento finisce in `vectorize_documenti` solo
 * dopo che i suoi vettori sono su Vectorize e i suoi passaggi su Turso. Se il
 * tempo, il budget giornaliero dei neuroni o lo spazio finiscono, si ferma in
 * modo pulito e la volta dopo riprende dal primo documento non ancora fatto
 * (route di manutenzione, cron giornaliero, cron del lunedi').
 *
 * Costi (tutti dentro le quote incluse):
 *   - neuroni: EmbeddingGemma-2 costa 154 neuroni per milione di token; al
 *     massimo VECTORIZE_NEURONI_GIORNO (5.000) al giorno per l'indicizzazione,
 *     sempre dentro il tetto globale di 8.800 di lib/ai/budget.ts;
 *   - dimensioni memorizzate: la prima costruzione usa al massimo l'82% del
 *     tetto (4,5 milioni di default: circa 3,7): il resto resta agli atti futuri;
 *     i manuali lunghissimi entrano con un numero limitato di passaggi
 *     distribuiti sul testo (il resto e' comunque trovabile con la ricerca
 *     testuale). Mai oltre il tetto.
 *   - doppioni esatti esclusi (documenti_meta.duplicato_di).
 */

const intero = (v: string | undefined, def: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== "" ? Math.min(max, Math.max(min, Math.round(n))) : def;
};

export const NEURONI_GIORNO_INDICE = intero(process.env.VECTORIZE_NEURONI_GIORNO, 5_000, 0, 8_000);
/** Quota del tetto per la prima costruzione (il resto resta agli atti futuri). */
const QUOTA_COSTRUZIONE = 0.82;
const MIN_CARATTERI = 200;
const LOTTO_EMBED = 32;
const LOTTO_UPSERT = 500;
const LOTTO_INSERT = 100;
const PARALLELI = 4;

/* -------------------------------------------------------------------------- */
/* Stato chiave/valore                                                         */
/* -------------------------------------------------------------------------- */

async function leggiKv(db: Client, chiave: string): Promise<string | null> {
  const rs = await db.execute({ sql: `SELECT valore FROM vectorize_indice WHERE chiave = ?`, args: [chiave] });
  return rs.rows.length ? String(rs.rows[0].valore) : null;
}

async function scriviKv(db: Client, chiave: string, valore: string): Promise<void> {
  await db.execute({
    sql: `INSERT INTO vectorize_indice (chiave, valore) VALUES (?, ?) ON CONFLICT(chiave) DO UPDATE SET valore = excluded.valore`,
    args: [chiave, valore],
  });
}

/** Somma atomica: due esecuzioni non si sovrascrivono il conteggio. */
async function sommaKv(db: Client, chiave: string, delta: number): Promise<void> {
  const d = Math.round(delta * 100) / 100;
  await db.execute({
    sql: `INSERT INTO vectorize_indice (chiave, valore) VALUES (?, ?)
          ON CONFLICT(chiave) DO UPDATE SET valore = CAST(ROUND(CAST(vectorize_indice.valore AS REAL) + ?, 2) AS TEXT)`,
    args: [chiave, String(d), d],
  });
}

/**
 * Una sola indicizzazione alla volta (cron notturno, cron del lunedi',
 * manutenzione a mano): turno con scadenza su Turso, preso in modo atomico.
 * Se una funzione viene interrotta, il turno scade da solo.
 */
const CHIAVE_TURNO = "esecuzione_in_corso";

async function prendiTurno(db: Client, durataMs: number): Promise<string | null> {
  const adesso = Date.now();
  const valore = `${adesso + durataMs}:${Math.random().toString(36).slice(2, 10)}`;
  const rs = await db.execute({
    sql: `INSERT INTO vectorize_indice (chiave, valore) VALUES (?, ?)
          ON CONFLICT(chiave) DO UPDATE SET valore = excluded.valore
          WHERE CAST(substr(vectorize_indice.valore, 1, instr(vectorize_indice.valore, ':') - 1) AS INTEGER) < ?`,
    args: [CHIAVE_TURNO, valore, adesso],
  });
  return rs.rowsAffected > 0 ? valore : null;
}

async function lasciaTurno(db: Client, valore: string): Promise<void> {
  await db.execute({ sql: `DELETE FROM vectorize_indice WHERE chiave = ? AND valore = ?`, args: [CHIAVE_TURNO, valore] }).catch(() => undefined);
}

/* -------------------------------------------------------------------------- */
/* Piano                                                                       */
/* -------------------------------------------------------------------------- */

interface Ammissibile {
  id: number;
  caratteri: number;
}

/** Documenti da indicizzare: testo utile e nessun doppione esatto. */
async function ammissibili(db: Client): Promise<Ammissibile[]> {
  const meta = await haMetadati(db);
  const rs = await db.execute(
    `SELECT d.id, LENGTH(d.testo_estratto) AS n FROM documenti d
     ${meta ? "LEFT JOIN documenti_meta m ON m.doc_id = d.id" : ""}
     WHERE LENGTH(d.testo_estratto) >= ${MIN_CARATTERI} ${meta ? "AND m.duplicato_di IS NULL" : ""}
     ORDER BY d.id`
  );
  return rs.rows.map((r) => ({ id: Number(r.id), caratteri: Number(r.n ?? 0) }));
}

export interface PianoIndice {
  generazione: string;
  modello: string;
  dimensioni: number;
  documenti: number;
  passaggiStimati: number;
  vettoriPrevisti: number;
  budgetVettori: number;
  tettoVettori: number;
  /** Passaggi massimi per documento (0 = nessun tetto). */
  kPerDocumento: number;
  /** Neuroni stimati (con margine) per indicizzare i documenti mancanti. */
  neuroniStimati: number;
}

export function calcolaPiano(elenco: Ammissibile[], dimensioni = EMBEDDING_DIMS): Omit<PianoIndice, "generazione" | "modello" | "neuroniStimati"> {
  const stime = elenco.map((e) => stimaPassaggi(e.caratteri));
  const tettoVettori = Math.floor(TETTO_MEMORIZZATE / dimensioni);
  const budgetVettori = Math.floor(tettoVettori * QUOTA_COSTRUZIONE);
  const k = tettoPerDocumento(stime, budgetVettori);
  return {
    dimensioni,
    documenti: elenco.length,
    passaggiStimati: stime.reduce((s, n) => s + n, 0),
    vettoriPrevisti: stime.reduce((s, n) => s + (k ? Math.min(n, k) : n), 0),
    budgetVettori,
    tettoVettori,
    kPerDocumento: k,
  };
}

/** Neuroni (con margine) per gli embedding di `caratteri` di testo in `passaggi` passaggi. */
export function stimaNeuroniEmbedding(caratteri: number, passaggi: number): number {
  const prefissi = passaggi * 60; // "title: ... | text: "
  return neuroni(EMBEDDING_MODEL, stimaToken(caratteri + prefissi), 0) * MARGINE;
}

export interface StatoRicostruzione {
  piano: PianoIndice | null;
  indicizzati: number;
  vettori: number;
  daFare: number;
  completataIl: string | null;
  avviataIl: string | null;
  neuroniOggi: number;
  neuroniGiorno: number;
  /** Un'esecuzione sta lavorando ora (turno non scaduto). */
  inCorso: boolean;
}

/** Piano e avanzamento (nessuna chiamata AI). */
export async function statoRicostruzione(db: Client): Promise<StatoRicostruzione> {
  await assicuraSchemaIndice(db);
  const elenco = await ammissibili(db);
  const fatti = await db.execute(`SELECT doc_id, caratteri, vettori, totali FROM vectorize_documenti`);
  const perDoc = new Map(fatti.rows.map((r) => [Number(r.doc_id), { caratteri: Number(r.caratteri), vettori: Number(r.vettori), totali: Number(r.totali) }]));
  const p = calcolaPiano(elenco);
  const kSalvato = await leggiKv(db, "k_per_doc");
  const k = kSalvato === null || (await leggiKv(db, "tetto_memorizzate")) !== String(TETTO_MEMORIZZATE) ? p.kPerDocumento : Number(kSalvato);
  const mancanti = elenco.filter((e) => {
    const d = perDoc.get(e.id);
    return !d || d.caratteri !== e.caratteri || d.vettori !== attesi(d.totali, k);
  });
  const neuroniStimati = mancanti.reduce((s, e) => {
    const n = stimaPassaggi(e.caratteri);
    const usati = k ? Math.min(n, k) : n;
    return s + stimaNeuroniEmbedding(Math.min(e.caratteri, usati * 2000), usati);
  }, 0);
  return {
    piano: { ...p, kPerDocumento: k, generazione: generazioneCorrente(), modello: EMBEDDING_MODEL, neuroniStimati: Math.ceil(neuroniStimati) },
    indicizzati: fatti.rows.length,
    vettori: fatti.rows.reduce((s, r) => s + Number(r.vettori ?? 0), 0),
    daFare: mancanti.length,
    completataIl: await leggiKv(db, "completata_il"),
    avviataIl: await leggiKv(db, "avviata_il"),
    neuroniOggi: Number((await leggiKv(db, `neuroni:${giornoUtc()}`)) ?? 0),
    neuroniGiorno: NEURONI_GIORNO_INDICE,
    inCorso: Number((await leggiKv(db, CHIAVE_TURNO))?.split(":")[0] ?? 0) > Date.now(),
  };
}

/* -------------------------------------------------------------------------- */
/* Esecuzione                                                                  */
/* -------------------------------------------------------------------------- */

export interface EsitoIndice {
  generazione: string;
  documenti: number;
  vettori: number;
  rimossi: number;
  neuroni: number;
  residui: number;
  completata: boolean;
  /** Perche' si e' fermata prima di finire (null = finito tutto il possibile). */
  arresto: string | null;
  durataMs: number;
}

export interface OpzioniIndice {
  /** Tempo massimo di lavoro (default 240 s). */
  budgetMs?: number;
  /** Neuroni massimi in questa esecuzione (sempre entro il tetto giornaliero). */
  maxNeuroni?: number;
  /** Solo questi documenti (es. appena importati dal cron). */
  soloIds?: number[];
}

const arrotonda = (v: number[]) => v.map((x) => Math.round(x * 1e6) / 1e6);
/** Vettori attesi per un documento di `totali` passaggi con tetto `k` (0 = nessuno). */
const attesi = (totali: number, k: number) => (k ? Math.min(totali, k) : totali);

/** Indicizza i documenti mancanti o cambiati. Mai un'eccezione: esito leggibile. */
export async function indicizzaDocumenti(db: Client, opz: OpzioniIndice = {}): Promise<EsitoIndice> {
  const t0 = Date.now();
  const budgetMs = opz.budgetMs ?? 240_000;
  const esito: EsitoIndice = { generazione: generazioneCorrente(), documenti: 0, vettori: 0, rimossi: 0, neuroni: 0, residui: 0, completata: false, arresto: null, durataMs: 0 };
  const fine = (arresto: string | null) => ({ ...esito, arresto, durataMs: Date.now() - t0 });

  if (!process.env.CF_ACCOUNT_ID || !process.env.CF_API_TOKEN || !process.env.CF_VECTORIZE_INDEX) return fine("Vectorize non configurato");
  if (!(await assicuraSchemaIndice(db))) return fine("tabelle dell'indice non disponibili su Turso");
  const info = await leggiInfo(true);
  if (!info) return fine(`indice Vectorize non raggiungibile (${ultimoErroreInfo() || "errore"})`);
  if (info.dimensioni !== EMBEDDING_DIMS) {
    return fine(`l'indice ha ${info.dimensioni} dimensioni e il modello ${EMBEDDING_DIMS}: va ricreato (DEPLOY.md, «Ricostruzione di Vectorize»)`);
  }

  let turno: string | null;
  try {
    turno = await prendiTurno(db, budgetMs + 90_000);
  } catch (err) {
    return fine(`errore: ${(err as Error).message.slice(0, 200)}`);
  }
  if (!turno) return fine("un'altra indicizzazione è in corso: riprende alla prossima");

  try {
    // Nuova generazione (indice ricreato o modello cambiato): si riparte da zero.
    const gen = generazioneCorrente();
    if ((await leggiKv(db, "generazione")) !== gen) {
      await db.batch([`DELETE FROM passaggi`, `DELETE FROM vectorize_documenti`, `DELETE FROM vectorize_indice WHERE chiave NOT LIKE 'neuroni:%' AND chiave <> '${CHIAVE_TURNO}'`], "write");
      await scriviKv(db, "generazione", gen);
      await scriviKv(db, "avviata_il", new Date().toISOString());
    }

    const elenco = await ammissibili(db);
    const ammessi = new Set(elenco.map((e) => e.id));
    // Piano stabile finche' non cambia il tetto: se lo si alza (o abbassa) il
    // numero di passaggi per documento si ricalcola e si aggiustano solo i
    // documenti con un numero di vettori diverso da quello atteso.
    let kSalvato = await leggiKv(db, "k_per_doc");
    if (kSalvato === null || (await leggiKv(db, "tetto_memorizzate")) !== String(TETTO_MEMORIZZATE)) {
      const piano = calcolaPiano(elenco);
      kSalvato = String(piano.kPerDocumento);
      await scriviKv(db, "k_per_doc", kSalvato);
      await scriviKv(db, "tetto_memorizzate", String(TETTO_MEMORIZZATE));
      await scriviKv(db, "piano", JSON.stringify({ ...piano, calcolatoIl: new Date().toISOString() }));
    }
    const k = Number(kSalvato) || 0;

    // Documenti spariti dal corpus o diventati doppioni: fuori dall'indice.
    const fatti = await db.execute(`SELECT doc_id, caratteri, vettori, totali FROM vectorize_documenti`);
    const perDoc = new Map(fatti.rows.map((r) => [Number(r.doc_id), { caratteri: Number(r.caratteri), vettori: Number(r.vettori), totali: Number(r.totali) }]));
    const daRimuovere = [...perDoc.keys()].filter((id) => !ammessi.has(id));
    if (daRimuovere.length) {
      const ids = await db.execute({ sql: `SELECT id FROM passaggi WHERE doc_id IN (${daRimuovere.map(() => "?").join(",")})`, args: daRimuovere });
      await vectorDeleteByIds(ids.rows.map((r) => String(r.id)));
      await db.batch(
        [
          { sql: `DELETE FROM passaggi WHERE doc_id IN (${daRimuovere.map(() => "?").join(",")})`, args: daRimuovere },
          { sql: `DELETE FROM vectorize_documenti WHERE doc_id IN (${daRimuovere.map(() => "?").join(",")})`, args: daRimuovere },
        ],
        "write"
      );
      for (const id of daRimuovere) perDoc.delete(id);
      esito.rimossi = daRimuovere.length;
    }

    const daRifare = (e: Ammissibile) => {
      const d = perDoc.get(e.id);
      return !d || d.caratteri !== e.caratteri || d.vettori !== attesi(d.totali, k);
    };
    let daFare = elenco.filter(daRifare);
    if (opz.soloIds?.length) {
      const solo = new Set(opz.soloIds);
      daFare = daFare.filter((e) => solo.has(e.id));
    }

    const giorno = giornoUtc();
    const spesiOggi = Number((await leggiKv(db, `neuroni:${giorno}`)) ?? 0);
    const residuoGiorno = Math.max(0, NEURONI_GIORNO_INDICE - spesiOggi);
    // Tetto chiesto per QUESTA esecuzione (?neuroni=N) piu' basso di quello del giorno.
    const perEsecuzione = opz.maxNeuroni !== undefined && opz.maxNeuroni < residuoGiorno;
    const tetto: TettoLocale = {
      nome: perEsecuzione ? "questa indicizzazione" : "indicizzazione di oggi",
      limite: Math.max(0, Math.min(opz.maxNeuroni ?? Infinity, residuoGiorno)),
      usati: 0,
    };
    const tettoVettori = Math.floor(TETTO_MEMORIZZATE / EMBEDDING_DIMS);
    let vettoriCaricati = Math.max(info.vettori, [...perDoc.values()].reduce((s, d) => s + d.vettori, 0));
    let arresto: string | null = null;
    let impegnati = 0;
    const coda = [...daFare];

    const lavora = async (): Promise<void> => {
      for (;;) {
        if (arresto) return;
        if (Date.now() - t0 > budgetMs) {
          arresto ??= "tempo dell'esecuzione esaurito: riprende alla prossima";
          return;
        }
        const e = coda.shift();
        if (!e) return;
        const rs = await db.execute({ sql: `SELECT titolo, cartella_origine AS cartella, anno, testo_estratto AS testo FROM documenti WHERE id = ?`, args: [e.id] });
        const doc = rs.rows[0];
        if (!doc) continue;
        const testo = String(doc.testo ?? "");
        const titolo = String(doc.titolo ?? "");
        const tutti = spezzaInPassaggi(testo);
        const tuttiPassaggi = tutti.length;
        const scelti: Passaggio[] = selezionaPassaggi(tutti, k);
        if (!scelti.length) continue;
        const testi = scelti.map((p) => ritaglio(testo, p));

        // Spazio (prenotato subito: niente corse tra i lavori in parallelo).
        const prima = perDoc.get(e.id)?.vettori ?? 0;
        const netti = scelti.length - prima;
        if (vettoriCaricati + netti > tettoVettori) {
          arresto ??= `tetto di ${TETTO_MEMORIZZATE / 1e6} milioni di dimensioni memorizzate raggiunto`;
          coda.unshift(e);
          return;
        }
        // Budget: si parte solo se l'intero documento ci sta (contando anche
        // i documenti gia' in lavorazione negli altri lavori paralleli).
        const caratteriInput = testi.reduce((s, t) => s + testoPerEmbedding(t, "documento", titolo).length, 0);
        const stima = neuroni(EMBEDDING_MODEL, stimaToken(caratteriInput) + scelti.length, 0) * MARGINE;
        if (tetto.usati + impegnati + stima > tetto.limite) {
          arresto ??= perEsecuzione
            ? `budget di questa esecuzione esaurito (${Math.round(tetto.usati * 100) / 100}/${opz.maxNeuroni} neuroni): riprende alla prossima`
            : `budget di indicizzazione di oggi esaurito (${Math.round(spesiOggi + tetto.usati)}/${NEURONI_GIORNO_INDICE} neuroni): riprende domani`;
          coda.unshift(e);
          return;
        }
        vettoriCaricati += netti;
        impegnati += stima;

        try {
          const vettori: VettoreUpsert[] = [];
          for (let i = 0; i < scelti.length; i += LOTTO_EMBED) {
            const lotto = scelti.slice(i, i + LOTTO_EMBED);
            const v = await embedMany(testi.slice(i, i + LOTTO_EMBED), { tipo: "documento", titoli: lotto.map(() => titolo) });
            lotto.forEach((p, j) =>
              vettori.push({
                id: `${e.id}-${p.ord}`,
                values: arrotonda(v[j]),
                metadata: { docId: e.id, anno: Number(doc.anno ?? 0) || 0, cartella: String(doc.cartella ?? "") },
              })
            );
          }
          for (let i = 0; i < vettori.length; i += LOTTO_UPSERT) await vectorUpsert(vettori.slice(i, i + LOTTO_UPSERT));
          if (prima) {
            // Documento cambiato: via i passaggi che non esistono piu'.
            const nuovi = new Set(vettori.map((v) => v.id));
            const vecchi = await db.execute({ sql: `SELECT id FROM passaggi WHERE doc_id = ?`, args: [e.id] });
            await vectorDeleteByIds(vecchi.rows.map((r) => String(r.id)).filter((id) => !nuovi.has(id)));
          }
          const scritture: Array<{ sql: string; args: Array<string | number> }> = [{ sql: `DELETE FROM passaggi WHERE doc_id = ?`, args: [e.id] }];
          for (let i = 0; i < scelti.length; i += LOTTO_INSERT) {
            const lotto = scelti.slice(i, i + LOTTO_INSERT);
            scritture.push({
              sql: `INSERT OR REPLACE INTO passaggi (id, doc_id, ord, inizio, lunghezza) VALUES ${lotto.map(() => "(?,?,?,?,?)").join(",")}`,
              args: lotto.flatMap((p) => [`${e.id}-${p.ord}`, e.id, p.ord, p.inizio, p.lunghezza]),
            });
          }
          scritture.push({
            sql: `INSERT OR REPLACE INTO vectorize_documenti (doc_id, vettori, totali, caratteri, modello, dimensioni, indicizzato_il) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            args: [e.id, scelti.length, tuttiPassaggi, e.caratteri, EMBEDDING_MODEL, EMBEDDING_DIMS, new Date().toISOString()],
          });
          await db.batch(scritture, "write");
          perDoc.set(e.id, { caratteri: e.caratteri, vettori: scelti.length, totali: tuttiPassaggi });
          esito.documenti++;
          esito.vettori += scelti.length;
          impegnati -= stima;
        } catch (err) {
          vettoriCaricati -= netti;
          impegnati -= stima;
          coda.unshift(e);
          if (err instanceof BudgetAiEsaurito || quotaEsaurita(err)) arresto ??= `budget AI: ${(err as Error).message.slice(0, 160)}`;
          else if (err instanceof CloudflareError && (err.status === 401 || err.status === 403)) arresto ??= "il token Cloudflare non ha il permesso Vectorize Write";
          else arresto ??= `errore sul documento ${e.id}: ${(err as Error).message.slice(0, 160)}`;
          return;
        }
      }
    };

    await conServizioAi("cron", () => Promise.all(Array.from({ length: PARALLELI }, () => lavora())), tetto);

    esito.neuroni = Math.round(tetto.usati * 100) / 100;
    if (tetto.usati > 0) await sommaKv(db, `neuroni:${giorno}`, tetto.usati);
    const residui = elenco.filter(daRifare).length;
    esito.residui = residui;
    if (residui === 0) {
      esito.completata = true;
      if (!(await leggiKv(db, "completata_il"))) await scriviKv(db, "completata_il", new Date().toISOString());
    }
    invalidaRiepilogo();
    return fine(arresto);
  } catch (err) {
    invalidaRiepilogo();
    return fine(`errore: ${(err as Error).message.slice(0, 200)}`);
  } finally {
    await lasciaTurno(db, turno);
  }
}
