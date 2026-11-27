import type { Client, Row } from "@libsql/client";
import { getDb } from "@/lib/db";
import { contaDocumenti, MAX_DURATA_ESECUZIONE_MS } from "./archivio";
import type {
  EsecuzioneRiepilogo,
  EsitoEsecuzione,
  StatoAggiornamenti,
  StatoAggiornamentiBreve,
  StatoFonte,
  VoceImportata,
} from "./tipi";

/** Pianificazione del cron (deve combaciare con vercel.json). */
export const CRON_AGGIORNAMENTO = "0 5 * * 1";
export const DESCRIZIONE_CRON =
  "Ogni lunedì alle 05:00 UTC (06:00 ora solare, 07:00 ora legale in Italia). Sul piano Hobby Vercel l'avvio può slittare entro l'ora.";

/** Prossimo lunedi' alle 05:00 UTC. */
export function prossimaEsecuzione(da = new Date()): string {
  const d = new Date(Date.UTC(da.getUTCFullYear(), da.getUTCMonth(), da.getUTCDate(), 5, 0, 0));
  const giorniAlLunedi = (1 - d.getUTCDay() + 7) % 7;
  d.setUTCDate(d.getUTCDate() + giorniAlLunedi);
  if (d.getTime() <= da.getTime()) d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString();
}

function json<T>(s: unknown): T | null {
  if (typeof s !== "string" || !s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function riga(r: Row, conDettagli: boolean): EsecuzioneRiepilogo {
  let esito = String(r.esito) as EsitoEsecuzione;
  const avviata = String(r.avviata_il);
  // Un "in_corso" troppo vecchio e' un'esecuzione morta senza chiudersi.
  if (esito === "in_corso" && Date.now() - Date.parse(avviata) > MAX_DURATA_ESECUZIONE_MS) esito = "interrotta";
  const dettagli = conDettagli ? json<{ fonti?: StatoFonte[]; errori?: string[] }>(r.dettagli) : null;
  return {
    id: Number(r.id),
    avviataIl: avviata,
    conclusaIl: r.conclusa_il == null ? null : String(r.conclusa_il),
    durataMs: r.durata_ms == null ? null : Number(r.durata_ms),
    innesco: String(r.innesco) as EsecuzioneRiepilogo["innesco"],
    esito,
    fontiControllate: Number(r.fonti_controllate ?? 0),
    fontiInErrore: Number(r.fonti_in_errore ?? 0),
    vociLette: Number(r.voci_lette ?? 0),
    nuoveVoci: Number(r.nuove_voci ?? 0),
    pertinenti: Number(r.pertinenti ?? 0),
    importati: Number(r.importati ?? 0),
    duplicati: Number(r.duplicati ?? 0),
    scartati: Number(r.scartati ?? 0),
    errori: Number(r.errori ?? 0),
    messaggio: String(r.messaggio ?? ""),
    ...(dettagli?.fonti ? { fonti: dettagli.fonti } : {}),
    ...(dettagli?.errori ? { dettagliErrori: dettagli.errori } : {}),
  };
}

async function tabelleEsistono(db: Client): Promise<boolean> {
  const rs = await db.execute(
    `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('aggiornamenti_esecuzioni', 'aggiornamenti_voci')`
  );
  return Number(rs.rows[0]?.n ?? 0) === 2;
}

const COLONNE_ESEC = `id, avviata_il, conclusa_il, durata_ms, innesco, esito, fonti_controllate,
  fonti_in_errore, voci_lette, nuove_voci, pertinenti, importati, duplicati, scartati, errori, messaggio`;

export async function leggiStato(): Promise<StatoAggiornamenti> {
  const db = getDb();
  const avvisi: string[] = [];
  const configurazione = {
    cronSecret: !!process.env.CRON_SECRET,
    turso: !!process.env.TURSO_DATABASE_URL,
    cloudflare: !!(process.env.CF_ACCOUNT_ID && process.env.CF_API_TOKEN),
    webhook: !!process.env.AGGIORNAMENTI_WEBHOOK_URL,
  };
  if (!configurazione.cronSecret) {
    avvisi.push("CRON_SECRET non configurato: il cron di Vercel non può autenticarsi e l'aggiornamento non parte.");
  }

  const documenti = await contaDocumenti(db);
  const base: StatoAggiornamenti = {
    generatoIl: new Date().toISOString(),
    configurazione,
    pianificazione: { cron: CRON_AGGIORNAMENTO, descrizione: DESCRIZIONE_CRON, prossima: prossimaEsecuzione() },
    documenti,
    ultimaEsecuzione: null,
    ultimoSuccesso: null,
    esecuzioni: [],
    voci: [],
    avvisi,
  };

  if (!(await tabelleEsistono(db))) {
    avvisi.push("Nessuna esecuzione registrata: l'aggiornamento automatico non è ancora mai partito.");
    return base;
  }

  const [esec, ultimaOk, voci] = await Promise.all([
    db.execute(`SELECT ${COLONNE_ESEC}, dettagli FROM aggiornamenti_esecuzioni WHERE innesco <> 'prova' ORDER BY id DESC LIMIT 15`),
    db.execute(
      `SELECT ${COLONNE_ESEC}, dettagli FROM aggiornamenti_esecuzioni
       WHERE esito IN ('ok', 'nessuna_novita') ORDER BY id DESC LIMIT 1`
    ),
    (async () => {
      const archivio = (await db.execute(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'archivio_pdf'`)).rows.length > 0;
      return db.execute(
        `SELECT v.url, v.fonte, v.tipo, v.numero, v.data, v.anno, COALESCE(v.titolo, v.titolo_fonte) AS titolo, v.cartella,
                v.doc_id, v.stato, v.motivo, v.semantico, v.importato_il${archivio ? ", a.url_pubblico AS archivio" : ""}
         FROM aggiornamenti_voci v ${archivio ? "LEFT JOIN archivio_pdf a ON a.url = v.url" : ""}
         WHERE v.stato IN ('importato', 'errore', 'duplicato', 'needs_ocr')
         ORDER BY COALESCE(v.importato_il, v.aggiornato_il) DESC LIMIT 60`
      );
    })(),
  ]);

  base.esecuzioni = esec.rows.map((r, i) => riga(r, i === 0));
  base.ultimaEsecuzione = base.esecuzioni[0] ?? null;
  base.ultimoSuccesso = ultimaOk.rows[0] ? riga(ultimaOk.rows[0], true) : null;
  base.voci = voci.rows.map(
    (r): VoceImportata => ({
      url: String(r.url),
      fonte: String(r.fonte),
      tipo: String(r.tipo),
      numero: r.numero == null ? null : String(r.numero),
      data: r.data == null ? null : String(r.data),
      anno: r.anno == null ? null : Number(r.anno),
      titolo: String(r.titolo ?? ""),
      cartella: String(r.cartella ?? ""),
      docId: r.doc_id == null ? null : Number(r.doc_id),
      stato: String(r.stato) as VoceImportata["stato"],
      motivo: r.motivo == null ? null : String(r.motivo),
      semantico: r.semantico == null ? null : String(r.semantico),
      importatoIl: r.importato_il == null ? null : String(r.importato_il),
      urlArchivio: r.archivio == null ? null : String(r.archivio),
    })
  );
  const daOcr = base.voci.filter((v) => v.stato === "needs_ocr").length;
  if (daOcr) {
    avvisi.push(`${daOcr} ${daOcr === 1 ? "atto scansionato attende" : "atti scansionati attendono"} l'OCR (gratuito, dal tuo PC): npm run ocr:locale. Elenco filtrabile qui sotto.`);
  }

  const ultima = base.ultimaEsecuzione;
  if (!ultima) {
    avvisi.push("Nessuna esecuzione registrata finora.");
  } else {
    const giorni = (Date.now() - Date.parse(ultima.avviataIl)) / 86_400_000;
    if (giorni > 8) {
      avvisi.push(
        `L'ultima esecuzione risale a ${Math.floor(giorni)} giorni fa: il cron settimanale potrebbe non essere attivo (verifica Settings → Cron Jobs su Vercel).`
      );
    }
    if (ultima.esito === "errore" || ultima.esito === "interrotta") {
      avvisi.push(`Ultima esecuzione: ${ultima.esito}. ${ultima.messaggio}`);
    } else if (ultima.esito === "parziale") {
      avvisi.push(`Ultima esecuzione parziale. ${ultima.messaggio}`);
    }
  }
  const semKo = base.voci.filter((v) => v.stato === "importato" && v.semantico && v.semantico !== "ok");
  if (semKo.length) {
    avvisi.push(
      `${semKo.length} atti importati non sono ancora indicizzati per Normie: ${semKo[0].semantico}. Verranno ritentati automaticamente.`
    );
  }
  return base;
}

export async function leggiStatoBreve(): Promise<StatoAggiornamentiBreve> {
  const db = getDb();
  const documenti = await contaDocumenti(db);
  if (!(await tabelleEsistono(db))) {
    return { documenti, ultimoControllo: null, ultimoEsito: null, ultimoSuccesso: null, importatiUltimi30gg: 0 };
  }
  const soglia = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [ultima, ok, recenti] = await Promise.all([
    db.execute(`SELECT avviata_il, esito FROM aggiornamenti_esecuzioni WHERE innesco <> 'prova' ORDER BY id DESC LIMIT 1`),
    db.execute(`SELECT avviata_il FROM aggiornamenti_esecuzioni WHERE esito IN ('ok','nessuna_novita') ORDER BY id DESC LIMIT 1`),
    db.execute({ sql: `SELECT COUNT(*) AS n FROM aggiornamenti_voci WHERE stato = 'importato' AND importato_il > ?`, args: [soglia] }),
  ]);
  let esito = (ultima.rows[0]?.esito as EsitoEsecuzione | undefined) ?? null;
  const avviata = ultima.rows[0]?.avviata_il ? String(ultima.rows[0].avviata_il) : null;
  if (esito === "in_corso" && avviata && Date.now() - Date.parse(avviata) > MAX_DURATA_ESECUZIONE_MS) esito = "interrotta";
  return {
    documenti,
    ultimoControllo: avviata,
    ultimoEsito: esito,
    ultimoSuccesso: ok.rows[0]?.avviata_il ? String(ok.rows[0].avviata_il) : null,
    importatiUltimi30gg: Number(recenti.rows[0]?.n ?? 0),
  };
}
