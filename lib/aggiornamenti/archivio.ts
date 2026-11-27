import type { Client, InValue } from "@libsql/client";

/**
 * Persistenza dell'aggiornamento automatico su Turso:
 *  - schema delle tabelle di servizio (idempotente, creato al primo uso);
 *  - registro delle esecuzioni e delle voci viste;
 *  - operazioni sul corpus `documenti` (deduplica, inserimento, FTS).
 *
 * Le tabelle di servizio sono NUOVE e separate: il corpus esistente non cambia
 * schema. L'inserimento in `documenti` introspeziona le colonne reali (la
 * tabella nasce dalla pipeline Python e puo' avere colonne in piu'), cosi' un
 * vincolo NOT NULL sconosciuto non fa fallire l'import.
 */

const DDL = [
  `CREATE TABLE IF NOT EXISTS aggiornamenti_esecuzioni (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     avviata_il TEXT NOT NULL,
     conclusa_il TEXT,
     durata_ms INTEGER,
     innesco TEXT NOT NULL,
     esito TEXT NOT NULL,
     fonti_controllate INTEGER NOT NULL DEFAULT 0,
     fonti_in_errore INTEGER NOT NULL DEFAULT 0,
     voci_lette INTEGER NOT NULL DEFAULT 0,
     nuove_voci INTEGER NOT NULL DEFAULT 0,
     pertinenti INTEGER NOT NULL DEFAULT 0,
     importati INTEGER NOT NULL DEFAULT 0,
     duplicati INTEGER NOT NULL DEFAULT 0,
     scartati INTEGER NOT NULL DEFAULT 0,
     errori INTEGER NOT NULL DEFAULT 0,
     messaggio TEXT NOT NULL DEFAULT '',
     dettagli TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_agg_esec_avviata ON aggiornamenti_esecuzioni(avviata_il)`,
  `CREATE TABLE IF NOT EXISTS aggiornamenti_voci (
     url TEXT PRIMARY KEY,
     fonte TEXT NOT NULL,
     tipo TEXT NOT NULL,
     chiave TEXT,
     numero TEXT,
     data TEXT,
     anno INTEGER,
     titolo_fonte TEXT,
     oggetto TEXT,
     stato TEXT NOT NULL,
     motivo TEXT,
     punteggio REAL,
     doc_id INTEGER,
     sha256 TEXT,
     tentativi INTEGER NOT NULL DEFAULT 0,
     titolo TEXT,
     cartella TEXT,
     testo TEXT,
     semantico TEXT,
     visto_il TEXT NOT NULL,
     aggiornato_il TEXT NOT NULL,
     importato_il TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS idx_agg_voci_stato ON aggiornamenti_voci(stato)`,
  `CREATE INDEX IF NOT EXISTS idx_agg_voci_chiave ON aggiornamenti_voci(chiave)`,
  // Scansioni fallite prima della coda OCR: passano in "needs_ocr" (idempotente).
  `UPDATE aggiornamenti_voci SET stato = 'needs_ocr', motivo = 'PDF scansionato senza testo: in coda per l''OCR locale (scripts/ocr-locale.ts)'
   WHERE stato = 'errore' AND motivo LIKE '%serve OCR%'`,
];

let schemaPronto: Promise<void> | null = null;

/** Crea le tabelle di servizio una volta per istanza. Fallisce se il token e' in sola lettura. */
export function assicuraSchema(db: Client): Promise<void> {
  if (!schemaPronto) {
    schemaPronto = db
      .batch(DDL, "write")
      .then(() => undefined)
      .catch((err) => {
        schemaPronto = null; // ritenta alla prossima esecuzione
        throw err;
      });
  }
  return schemaPronto;
}

export const ora = () => new Date().toISOString();

/* -------------------------------------------------------------------------- */
/* Esecuzioni                                                                  */
/* -------------------------------------------------------------------------- */

/** Un'esecuzione "in_corso" piu' vecchia di cosi' e' considerata interrotta. */
export const MAX_DURATA_ESECUZIONE_MS = 15 * 60 * 1000;

export async function esecuzioneInCorso(db: Client): Promise<boolean> {
  const soglia = new Date(Date.now() - MAX_DURATA_ESECUZIONE_MS).toISOString();
  const rs = await db.execute({
    sql: `SELECT id FROM aggiornamenti_esecuzioni WHERE esito = 'in_corso' AND avviata_il > ? LIMIT 1`,
    args: [soglia],
  });
  return rs.rows.length > 0;
}

/** Marca come "interrotta" un'esecuzione rimasta appesa (timeout o crash). */
export async function chiudiInterrotte(db: Client): Promise<void> {
  const soglia = new Date(Date.now() - MAX_DURATA_ESECUZIONE_MS).toISOString();
  await db.execute({
    sql: `UPDATE aggiornamenti_esecuzioni
          SET esito = 'interrotta',
              messaggio = 'Esecuzione interrotta prima della fine (timeout della funzione o errore fatale).'
          WHERE esito = 'in_corso' AND avviata_il <= ?`,
    args: [soglia],
  });
}

export async function apriEsecuzione(db: Client, innesco: string): Promise<number> {
  const rs = await db.execute({
    sql: `INSERT INTO aggiornamenti_esecuzioni (avviata_il, innesco, esito) VALUES (?, ?, 'in_corso')`,
    args: [ora(), innesco],
  });
  return Number(rs.lastInsertRowid);
}

export interface ChiusuraEsecuzione {
  esito: string;
  durataMs: number;
  fontiControllate: number;
  fontiInErrore: number;
  vociLette: number;
  nuoveVoci: number;
  pertinenti: number;
  importati: number;
  duplicati: number;
  scartati: number;
  errori: number;
  messaggio: string;
  dettagli: unknown;
}

export async function chiudiEsecuzione(db: Client, id: number, c: ChiusuraEsecuzione): Promise<void> {
  await db.execute({
    sql: `UPDATE aggiornamenti_esecuzioni SET
            conclusa_il = ?, durata_ms = ?, esito = ?, fonti_controllate = ?, fonti_in_errore = ?,
            voci_lette = ?, nuove_voci = ?, pertinenti = ?, importati = ?, duplicati = ?,
            scartati = ?, errori = ?, messaggio = ?, dettagli = ?
          WHERE id = ?`,
    args: [
      ora(), c.durataMs, c.esito, c.fontiControllate, c.fontiInErrore, c.vociLette, c.nuoveVoci,
      c.pertinenti, c.importati, c.duplicati, c.scartati, c.errori, c.messaggio.slice(0, 2000),
      JSON.stringify(c.dettagli).slice(0, 60000), id,
    ],
  });
}

/* -------------------------------------------------------------------------- */
/* Voci                                                                        */
/* -------------------------------------------------------------------------- */

export interface VoceNota {
  url: string;
  stato: string;
  tentativi: number;
}

export async function vociNote(db: Client, urls: string[]): Promise<Map<string, VoceNota>> {
  const out = new Map<string, VoceNota>();
  for (let i = 0; i < urls.length; i += 200) {
    const lotto = urls.slice(i, i + 200);
    const rs = await db.execute({
      sql: `SELECT url, stato, tentativi FROM aggiornamenti_voci WHERE url IN (${lotto.map(() => "?").join(",")})`,
      args: lotto,
    });
    for (const r of rs.rows) {
      out.set(String(r.url), { url: String(r.url), stato: String(r.stato), tentativi: Number(r.tentativi ?? 0) });
    }
  }
  return out;
}

export interface RegistraVoce {
  url: string;
  fonte: string;
  tipo: string;
  chiave?: string | null;
  numero?: string | null;
  data?: string | null;
  anno?: number | null;
  titoloFonte: string;
  oggetto: string;
  stato: string;
  motivo?: string | null;
  punteggio?: number | null;
  docId?: number | null;
  sha256?: string | null;
  titolo?: string | null;
  cartella?: string | null;
  testo?: string | null;
  semantico?: string | null;
  incrementaTentativi?: boolean;
}

/** Upsert della voce: la prima vista resta, il resto si aggiorna. */
export async function registraVoce(db: Client, v: RegistraVoce): Promise<void> {
  const adesso = ora();
  await db.execute({
    sql: `INSERT INTO aggiornamenti_voci
            (url, fonte, tipo, chiave, numero, data, anno, titolo_fonte, oggetto, stato, motivo,
             punteggio, doc_id, sha256, tentativi, titolo, cartella, testo, semantico,
             visto_il, aggiornato_il, importato_il)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(url) DO UPDATE SET
            chiave = excluded.chiave, numero = excluded.numero, data = excluded.data,
            anno = excluded.anno, titolo_fonte = excluded.titolo_fonte, oggetto = excluded.oggetto,
            stato = excluded.stato, motivo = excluded.motivo, punteggio = excluded.punteggio,
            doc_id = COALESCE(excluded.doc_id, aggiornamenti_voci.doc_id),
            sha256 = COALESCE(excluded.sha256, aggiornamenti_voci.sha256),
            tentativi = aggiornamenti_voci.tentativi + excluded.tentativi,
            titolo = COALESCE(excluded.titolo, aggiornamenti_voci.titolo),
            cartella = COALESCE(excluded.cartella, aggiornamenti_voci.cartella),
            testo = COALESCE(excluded.testo, aggiornamenti_voci.testo),
            semantico = COALESCE(excluded.semantico, aggiornamenti_voci.semantico),
            aggiornato_il = excluded.aggiornato_il,
            importato_il = COALESCE(excluded.importato_il, aggiornamenti_voci.importato_il)`,
    args: [
      v.url, v.fonte, v.tipo, v.chiave ?? null, v.numero ?? null, v.data ?? null, v.anno ?? null,
      v.titoloFonte.slice(0, 500), v.oggetto.slice(0, 1500), v.stato, (v.motivo ?? "").slice(0, 500) || null,
      v.punteggio ?? null, v.docId ?? null, v.sha256 ?? null, v.incrementaTentativi ? 1 : 0,
      v.titolo ?? null, v.cartella ?? null, v.testo ?? null, v.semantico ?? null,
      adesso, adesso, v.stato === "importato" ? adesso : null,
    ],
  });
}

export async function aggiornaSemantico(db: Client, url: string, semantico: string): Promise<void> {
  await db.execute({
    sql: `UPDATE aggiornamenti_voci SET semantico = ?, aggiornato_il = ? WHERE url = ?`,
    args: [semantico.slice(0, 300), ora(), url],
  });
}

/* -------------------------------------------------------------------------- */
/* Corpus                                                                      */
/* -------------------------------------------------------------------------- */

interface Colonna {
  nome: string;
  tipo: string;
  notNull: boolean;
  haDefault: boolean;
  pk: boolean;
}

let colonneCache: Colonna[] | null = null;

async function colonneDocumenti(db: Client): Promise<Colonna[]> {
  if (colonneCache) return colonneCache;
  const rs = await db.execute(`PRAGMA table_info(documenti)`);
  colonneCache = rs.rows.map((r) => ({
    nome: String(r.name),
    tipo: String(r.type ?? "").toUpperCase(),
    notNull: Number(r.notnull) === 1,
    haDefault: r.dflt_value !== null && r.dflt_value !== undefined,
    pk: Number(r.pk) > 0,
  }));
  return colonneCache;
}

const RE_TIPO: Record<string, RegExp> = {
  circolare: /\bcirc(?:olare)?\.?\s*(?:n\.?\s*)?0*NUM(?:\s*\/?\s*e)?\b/i,
  risoluzione: /\bris(?:oluzione)?\.?\s*(?:n\.?\s*)?0*NUM(?:\s*\/?\s*e)?\b/i,
  provvedimento: /\bprov(?:vedimento)?\.?\s*(?:n\.?\s*|prot\.?\s*(?:n\.?\s*)?)?0*NUM\b/i,
};

/**
 * Un atto con lo stesso tipo, numero e anno e' gia' nel corpus? I titoli del
 * corpus seguono lo schema "Circ. 27 - Oggetto" / "Prov. 153452 - Oggetto",
 * ma la cartella "00 - Sito Ade" usa forme libere ("Circolare11_2023 - ..."):
 * si confrontano titolo e nome file di tutti gli atti di quell'anno.
 */
const VUOTE = new Set(
  "a ad al alla alle ai agli con da dal dalla dalle dei degli del della delle di e ed il i gli la le lo l un una in nel nella nei per su sul sulla tra fra o che art n".split(" ")
);

function parole(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !VUOTE.has(t) && !/^\d+$/.test(t))
  );
}

/**
 * Somiglianza tra l'oggetto di un atto nuovo e i titoli del corpus STORICO
 * (non gli atti importati in automatico, che si distinguono gia' per URL):
 * intercetta i documenti caricati a mano senza numero (es. "00 - Sito Ade").
 * Soglia alta: atti fratelli come le "sezioni stralcio" di citta' diverse non
 * devono risultare duplicati l'uno dell'altro.
 */
function simile(oggetto: string, titolo: string): boolean {
  const a = parole(oggetto);
  const b = parole(titolo.replace(/^[^-]*\d[^-]*-\s*/, ""));
  if (a.size < 4 || b.size < 4) return false;
  let comuni = 0;
  for (const t of b) if (a.has(t)) comuni++;
  return comuni >= 5 && comuni / Math.min(a.size, b.size) >= 0.8;
}

export async function cercaDuplicato(
  db: Client,
  tipo: string,
  numero: string | null,
  anno: number | null,
  url: string,
  oggetto = ""
): Promise<number | null> {
  // 1) Stesso URL gia' importato in passato (anche se la voce e' stata persa).
  const perUrl = await db.execute({
    sql: `SELECT id FROM documenti WHERE nuovo_nome_file = ? LIMIT 1`,
    args: [url],
  });
  if (perUrl.rows.length) return Number(perUrl.rows[0].id);
  if (!anno) return null;

  // 2) Senza numero: somiglianza dell'oggetto con i titoli storici dello stesso anno.
  if (!numero) {
    if (!oggetto) return null;
    const rs = await db.execute({
      sql: `SELECT id, titolo FROM documenti WHERE anno = ? AND nuovo_nome_file NOT LIKE 'http%'`,
      args: [anno],
    });
    for (const r of rs.rows) if (simile(oggetto, String(r.titolo ?? ""))) return Number(r.id);
    return null;
  }

  const modello = RE_TIPO[tipo];
  if (!modello) return null;
  const re = new RegExp(modello.source.replace("NUM", numero), "i");
  // Prefisso dell'abbreviazione usata nei nomi file del corpus ("Ris.", "Circ.", "Prov.").
  const prefisso = ({ circolare: "circ", risoluzione: "ris", provvedimento: "prov" } as Record<string, string>)[tipo];
  const reFile = new RegExp(`${prefisso}\\w*[^0-9]{0,4}0*${numero}(?:[^0-9]|$)`, "i");
  const rs = await db.execute({
    sql: `SELECT id, titolo, nuovo_nome_file AS nome FROM documenti WHERE anno = ?`,
    args: [anno],
  });
  for (const r of rs.rows) {
    const titolo = String(r.titolo ?? "");
    const nome = String(r.nome ?? "");
    if (re.test(titolo) || re.test(nome) || reFile.test(nome.replace(/\s+/g, ""))) return Number(r.id);
  }
  return null;
}

export interface NuovoDocumento {
  cartella: string;
  nomeFile: string; // URL ufficiale (vedi lib/docs.ts)
  titolo: string;
  anno: number;
  testo: string;
  tipo: string;
  numero: string | null;
  data: string | null;
  sha256: string;
}

/** Valore di ripiego per una colonna NOT NULL senza default. */
function ripiego(c: Colonna): InValue {
  return /INT|REAL|NUM|FLOA|DOUB/.test(c.tipo) ? 0 : "";
}

/**
 * Inserisce il documento nel corpus e ne restituisce l'id. Le colonne note si
 * riempiono per nome; le altre NOT NULL senza default ricevono un valore
 * neutro. I trigger FTS creati da sql/fts5_setup.sql indicizzano la riga; se
 * mancano, `assicuraFts` la indicizza a mano.
 */
export async function inserisciDocumento(db: Client, d: NuovoDocumento): Promise<number> {
  const colonne = await colonneDocumenti(db);
  const valori = new Map<string, InValue>();
  const nomeOriginale = decodeURIComponent(d.nomeFile.split("/").filter(Boolean).slice(-2, -1)[0] || "").replace(/\+/g, " ");

  for (const c of colonne) {
    const n = c.nome.toLowerCase();
    if (c.pk && /INT/.test(c.tipo)) continue; // rowid: lo assegna SQLite
    let v: InValue | undefined;
    if (n === "cartella_origine") v = d.cartella;
    else if (n === "nuovo_nome_file") v = d.nomeFile;
    else if (n === "titolo") v = d.titolo;
    else if (n === "anno") v = d.anno;
    else if (n === "testo_estratto") v = d.testo;
    else if (n === "tema") v = "";
    else if (/url|link/.test(n)) v = d.nomeFile;
    else if (/sha|hash|impronta/.test(n)) v = d.sha256;
    else if (n === "numero") v = d.numero ?? "";
    else if (n === "tipo" || n === "tipologia") v = d.tipo;
    else if (/^data/.test(n)) v = d.data ?? "";
    else if (/estensione|ext/.test(n)) v = "pdf";
    else if (/nome_file|filename|file/.test(n)) v = nomeOriginale || d.titolo;
    else if (/fonte|origine/.test(n)) v = "aggiornamento automatico";
    if (v === undefined && c.notNull && !c.haDefault) v = ripiego(c);
    if (v !== undefined) valori.set(c.nome, v);
  }

  const nomi = [...valori.keys()];
  const rs = await db.execute({
    sql: `INSERT INTO documenti (${nomi.map((n) => `"${n.replace(/"/g, "")}"`).join(", ")})
          VALUES (${nomi.map(() => "?").join(", ")})`,
    args: nomi.map((n) => valori.get(n)!),
  });
  const id = Number(rs.lastInsertRowid);
  await assicuraFts(db, id, d);
  return id;
}

/** Verifica che la riga sia nell'indice FTS (external content) e la aggiunge se manca. */
async function assicuraFts(db: Client, id: number, d: NuovoDocumento): Promise<void> {
  const token = (d.titolo + " " + d.testo)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .split(/[^a-z0-9]+/)
    .find((t) => t.length >= 6);
  if (!token) return;
  try {
    const rs = await db.execute({
      sql: `SELECT rowid FROM documenti_fts WHERE documenti_fts MATCH ? AND rowid = ?`,
      args: [token, id],
    });
    if (rs.rows.length > 0) return;
    await db.execute({
      sql: `INSERT INTO documenti_fts(rowid, testo_estratto, titolo, tema) VALUES (?, ?, ?, '')`,
      args: [id, d.testo, d.titolo],
    });
  } catch (err) {
    console.warn("[aggiornamenti] verifica FTS non riuscita:", (err as Error).message);
  }
}

/**
 * Riconciliazione: se il corpus su Turso viene sovrascritto dalla pipeline
 * locale (sync del DB), gli atti importati in automatico sparirebbero. Le
 * voci "importato" conservano testo e metadati: si reinseriscono.
 */
export async function riconcilia(db: Client): Promise<{ ripristinati: number; errori: string[] }> {
  const rs = await db.execute(
    `SELECT v.url, v.tipo, v.numero, v.data, v.anno, v.titolo, v.cartella, v.testo, v.sha256, v.doc_id
     FROM aggiornamenti_voci v
     LEFT JOIN documenti d ON d.id = v.doc_id AND d.nuovo_nome_file = v.url
     WHERE v.stato = 'importato' AND d.id IS NULL AND v.testo IS NOT NULL
     LIMIT 50`
  );
  let ripristinati = 0;
  const errori: string[] = [];
  for (const r of rs.rows) {
    const url = String(r.url);
    try {
      const esistente = await db.execute({ sql: `SELECT id FROM documenti WHERE nuovo_nome_file = ? LIMIT 1`, args: [url] });
      let id: number;
      if (esistente.rows.length) id = Number(esistente.rows[0].id);
      else {
        id = await inserisciDocumento(db, {
          cartella: String(r.cartella ?? ""),
          nomeFile: url,
          titolo: String(r.titolo ?? ""),
          anno: Number(r.anno ?? 0),
          testo: String(r.testo ?? ""),
          tipo: String(r.tipo ?? ""),
          numero: r.numero == null ? null : String(r.numero),
          data: r.data == null ? null : String(r.data),
          sha256: String(r.sha256 ?? ""),
        });
        ripristinati++;
      }
      await db.execute({
        sql: `UPDATE aggiornamenti_voci SET doc_id = ?, semantico = CASE WHEN doc_id = ? THEN semantico ELSE NULL END, aggiornato_il = ? WHERE url = ?`,
        args: [id, id, ora(), url],
      });
    } catch (err) {
      errori.push(`ripristino di ${url}: ${(err as Error).message}`);
    }
  }
  return { ripristinati, errori };
}

export async function contaDocumenti(db: Client): Promise<number> {
  const rs = await db.execute(`SELECT COUNT(*) AS n FROM documenti`);
  return Number(rs.rows[0]?.n ?? 0);
}
