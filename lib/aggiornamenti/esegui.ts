import type { Client } from "@libsql/client";
import { conServizioAi } from "@/lib/ai/budget";
import { assicuraSchemaMetadati, eseguiBonifica } from "@/lib/metadati/bonifica";
import { REVISIONE_REGOLE } from "@/lib/metadati/normalizza";
import { confrontaNuoviAtti, type EsitoWatchlist } from "@/lib/watchlist/server";
import { archiviaPdf, r2Configurato } from "./r2";
import { getDb } from "@/lib/db";
import { chat } from "@/lib/cloudflare";
import { FONTI, parseElenco, scaricaElenco, type FonteConfig, type VoceFonte } from "./fonti";
import { valutaMetadati, valutaTesto } from "./pertinenza";
import { ErrorePdf, estraiProtocollo, estraiTesto, scaricaPdf } from "./pdf";
import { indicizzaImportati } from "./indicizza";
import {
  apriEsecuzione,
  assicuraSchema,
  cercaDuplicato,
  chiudiEsecuzione,
  chiudiInterrotte,
  esecuzioneInCorso,
  inserisciDocumento,
  registraVoce,
  riconcilia,
  vociNote,
} from "./archivio";
import type { EsitoEsecuzione, InnescoEsecuzione, StatoFonte, StatoVoce } from "./tipi";

/**
 * Esecuzione dell'aggiornamento automatico (cron del lunedi' o avvio manuale).
 *
 * Principio guida: NESSUN FALLIMENTO SILENZIOSO. Ogni esecuzione lascia una
 * riga in `aggiornamenti_esecuzioni` con esito, contatori e messaggio leggibile;
 * una fonte irraggiungibile o una pagina che ha cambiato struttura producono
 * un esito "parziale"/"errore" esplicito, mai un finto "nessuna novita'".
 */

export interface OpzioniEsecuzione {
  innesco: InnescoEsecuzione;
  /** Prova a secco: legge fonti e DB, non scrive nulla. */
  prova?: boolean;
  /** Massimo di atti importati per esecuzione (gli altri al giro dopo). */
  limiteImport?: number;
  /** Filtro sugli id delle fonti. */
  fonti?: string[];
  /** Tempo massimo prima di smettere di iniziare nuovi import. */
  budgetMs?: number;
}

export interface EsitoVoceRapporto {
  url: string;
  fonte: string;
  titoloFonte: string;
  oggetto: string;
  esito: StatoVoce | "da_importare" | "rimandata";
  motivo: string;
  titolo?: string;
  docId?: number | null;
}

export interface RapportoEsecuzione {
  id: number | null;
  innesco: InnescoEsecuzione;
  prova: boolean;
  esito: EsitoEsecuzione;
  messaggio: string;
  avviataIl: string;
  durataMs: number;
  fonti: StatoFonte[];
  vociLette: number;
  nuoveVoci: number;
  pertinenti: number;
  importati: number;
  duplicati: number;
  scartati: number;
  errori: number;
  ripristinati: number;
  indicizzati: number;
  /** Documenti passati dalla bonifica dei metadati in questa esecuzione. */
  metadatiNormalizzati: number;
  /** Id dei documenti importati in questa esecuzione (watchlist, dossier). */
  idImportati: number[];
  /** Argomenti seguiti e dossier in cache toccati dai nuovi atti. */
  watchlist?: EsitoWatchlist;
  /** PDF scansionati messi in coda per l'OCR locale. */
  daOcr: number;
  /** PDF copiati nell'archivio R2. */
  archiviati: number;
  voci: EsitoVoceRapporto[];
  dettagliErrori: string[];
}

const MAX_TENTATIVI = 3;

/** Tipologia normalizzata degli atti letti dalle fonti dell'Agenzia. */
const TIPO_CRON: Record<string, string> = { circolare: "Circolare", risoluzione: "Risoluzione", provvedimento: "Provvedimento" };

/* -------------------------------------------------------------------------- */
/* Titolo conciso (stesso stile dei titoli del corpus)                         */
/* -------------------------------------------------------------------------- */

const SYSTEM_TITOLI =
  "Sei un archivista esperto di normativa e prassi catastale italiana. Assegni a ogni documento un oggetto sintetico e preciso.";

export function oggettoDiRipiego(oggetto: string): string {
  const pulito = oggetto
    .replace(/^(?:oggetto\s*:\s*)/i, "")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const parole = pulito.split(" ");
  let out = "";
  for (const p of parole) {
    if ((out + " " + p).trim().length > 80) break;
    out = (out + " " + p).trim();
  }
  return out.replace(/[\s,;.–-]+$/, "") || "Atto senza oggetto";
}

/**
 * Oggetto breve (max 8 parole) generato dal modello come fa la pipeline locale
 * (scripts/genera_nomi_normie.py), con ripiego deterministico sull'oggetto
 * ufficiale se il modello non risponde o produce qualcosa di inservibile.
 */
export async function oggettoConciso(oggettoUfficiale: string, testo: string): Promise<string> {
  const ripiego = oggettoDiRipiego(oggettoUfficiale);
  if (!process.env.CF_ACCOUNT_ID || !process.env.CF_API_TOKEN) return ripiego;
  try {
    const r = await chat(
      [
        { role: "system", content: SYSTEM_TITOLI },
        {
          role: "user",
          content:
            "Scrivi UN SOLO oggetto conciso in italiano corretto, massimo 8 parole, che descriva il contenuto SPECIFICO del documento. " +
            "NON includere il tipo di atto, il numero, la data o l'ente emittente. Mantieni gli elementi distintivi (luoghi, uffici, servizi, istituti): " +
            "due atti diversi non devono avere lo stesso oggetto. Niente virgolette, niente punto finale. Rispondi solo con l'oggetto.\n\n" +
            `OGGETTO UFFICIALE: ${oggettoUfficiale.slice(0, 600)}\n\nTESTO:\n${testo.slice(0, 1800)}`,
        },
      ],
      { maxTokens: 40, temperature: 0.1, timeoutMs: 20_000 }
    );
    const pulito = r
      .split("\n")[0]
      .replace(/^["'«“\s]+|["'»”.\s]+$/g, "")
      .replace(/[\\/:*?"<>|]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const parole = pulito.split(" ").length;
    if (pulito.length < 6 || pulito.length > 90 || parole < 2 || parole > 12) return ripiego;
    if (/^(circolare|risoluzione|provvedimento|oggetto)\b/i.test(pulito)) return ripiego;
    return pulito;
  } catch {
    return ripiego;
  }
}

/* -------------------------------------------------------------------------- */
/* Esecuzione                                                                  */
/* -------------------------------------------------------------------------- */

export function chiaveAtto(tipo: string, numero: string | null, anno: number | null, data: string | null): string | null {
  if (numero && anno) return `${tipo}:${numero}:${anno}`;
  if (data) return `${tipo}:del:${data}`;
  return null;
}

async function leggiFonte(f: FonteConfig): Promise<{ stato: StatoFonte; voci: VoceFonte[] }> {
  const t0 = Date.now();
  const r = await scaricaElenco(f.url);
  const voci = r.ok ? parseElenco(r.html, f) : [];
  let errore = r.errore;
  if (r.ok && voci.length < f.minAttesi) {
    errore = `lette ${voci.length} voci (attese almeno ${f.minAttesi}): la pagina potrebbe aver cambiato struttura`;
  }
  return {
    stato: {
      id: f.id,
      nome: f.nome,
      url: f.url,
      ok: r.ok && voci.length >= f.minAttesi,
      httpStatus: r.status,
      voci: voci.length,
      nuove: 0,
      ms: Date.now() - t0,
      ...(errore ? { errore } : {}),
    },
    voci,
  };
}

/** Le chiamate AI del cron (titoli, embedding) attingono alla riserva protetta. */
export function eseguiAggiornamento(opts: OpzioniEsecuzione): Promise<RapportoEsecuzione> {
  return conServizioAi("cron", () => eseguiAggiornamentoCron(opts));
}

async function eseguiAggiornamentoCron(opts: OpzioniEsecuzione): Promise<RapportoEsecuzione> {
  const t0 = Date.now();
  const prova = !!opts.prova;
  const limite = Math.max(0, opts.limiteImport ?? 15);
  const budget = opts.budgetMs ?? 220_000;
  const rapporto: RapportoEsecuzione = {
    id: null,
    innesco: opts.innesco,
    prova,
    esito: "in_corso",
    messaggio: "",
    avviataIl: new Date(t0).toISOString(),
    durataMs: 0,
    fonti: [],
    vociLette: 0,
    nuoveVoci: 0,
    pertinenti: 0,
    importati: 0,
    duplicati: 0,
    scartati: 0,
    errori: 0,
    ripristinati: 0,
    indicizzati: 0,
    metadatiNormalizzati: 0,
    daOcr: 0,
    archiviati: 0,
    idImportati: [],
    voci: [],
    dettagliErrori: [],
  };

  const notiCron = new Map<number, { tipo?: string; numero?: string | null; data?: string | null }>();
  let db: Client;
  try {
    db = getDb();
  } catch (err) {
    rapporto.esito = "errore";
    rapporto.messaggio = `Database non configurato: ${(err as Error).message}`;
    return rapporto;
  }

  // 1) Registro dell'esecuzione (solo se non e' una prova).
  if (!prova) {
    try {
      await assicuraSchema(db);
      await chiudiInterrotte(db);
      if (await esecuzioneInCorso(db)) {
        rapporto.esito = "saltata";
        rapporto.messaggio = "Un'altra esecuzione è già in corso: questa è stata saltata.";
        return rapporto;
      }
      rapporto.id = await apriEsecuzione(db, opts.innesco);
    } catch (err) {
      rapporto.esito = "errore";
      rapporto.messaggio =
        "Impossibile scrivere il registro su Turso (il token potrebbe essere in sola lettura): " +
        (err as Error).message;
      console.error("[aggiornamenti]", rapporto.messaggio);
      return rapporto;
    }
  }

  try {
    // 2) Riconciliazione: atti importati spariti dal corpus (es. dopo un sync locale).
    if (!prova) {
      try {
        const r = await riconcilia(db);
        rapporto.ripristinati = r.ripristinati;
        rapporto.dettagliErrori.push(...r.errori);
      } catch (err) {
        rapporto.dettagliErrori.push(`riconciliazione: ${(err as Error).message}`);
      }
    }

    // 3) Lettura delle fonti (in parallelo: 4 pagine dello stesso sito).
    const fonti = FONTI.filter((f) => !opts.fonti?.length || opts.fonti.includes(f.id));
    const letture = await Promise.all(fonti.map(leggiFonte));
    rapporto.fonti = letture.map((l) => l.stato);
    for (const l of letture) if (l.stato.errore) rapporto.dettagliErrori.push(`${l.stato.nome}: ${l.stato.errore}`);

    // Stesso atto su due pagine (es. provvedimenti): deduplica per URL.
    const perUrl = new Map<string, VoceFonte>();
    for (const l of letture) for (const v of l.voci) if (!perUrl.has(v.url)) perUrl.set(v.url, v);
    const tutte = [...perUrl.values()];
    rapporto.vociLette = tutte.length;

    // 4) Voci gia' viste (le "errore" si ritentano fino a MAX_TENTATIVI).
    let note = new Map<string, { stato: string; tentativi: number }>();
    try {
      note = await vociNote(db, tutte.map((v) => v.url));
    } catch (err) {
      if (!prova) throw err;
      // In prova la tabella puo' non esistere ancora: tutte le voci sono "nuove".
    }
    const nuove = tutte
      .filter((v) => {
        const n = note.get(v.url);
        return !n || (n.stato === "errore" && n.tentativi < MAX_TENTATIVI);
      })
      // Dal piu' recente: se il tempo o il limite si esauriscono, slittano alla
      // settimana dopo gli atti meno attuali, non le novita'.
      .sort((a, b) => (b.data ?? "").localeCompare(a.data ?? ""));
    rapporto.nuoveVoci = nuove.length;
    for (const s of rapporto.fonti) s.nuove = nuove.filter((v) => v.fonte === s.id).length;

    // 5) Elaborazione voce per voce (sequenziale: gentile col sito sorgente).
    const fontiPerId = new Map(FONTI.map((f) => [f.id, f]));
    for (const v of nuove) {
      const fonte = fontiPerId.get(v.fonte)!;
      const base = { url: v.url, fonte: v.fonte, titoloFonte: v.titoloFonte, oggetto: v.oggetto };

      if (Date.now() - t0 > budget || rapporto.importati >= limite) {
        rapporto.voci.push({ ...base, esito: "rimandata", motivo: "tempo o limite di import esauriti: alla prossima esecuzione" });
        continue;
      }

      const meta = valutaMetadati(v.titoloFonte, v.oggetto);
      if (!meta.scarica) {
        rapporto.scartati++;
        const motivo = meta.organizzativo
          ? "atto organizzativo o del personale (selezioni, nomine, assunzioni): non è normativa"
          : "oggetto non pertinente al catasto (nessun termine del dominio)";
        rapporto.voci.push({ ...base, esito: "non_pertinente", motivo });
        if (!prova) {
          await registraVoce(db, { ...base, tipo: v.tipo, numero: v.numero, data: v.data, anno: v.anno, chiave: chiaveAtto(v.tipo, v.numero, v.anno, v.data), stato: "non_pertinente", motivo, punteggio: 0 });
        }
        continue;
      }

      // PDF: download ed estrazione del testo.
      let estratto;
      let pdf: Uint8Array | null = null;
      try {
        pdf = await scaricaPdf(v.urlDownload);
        estratto = await estraiTesto(pdf);
      } catch (err) {
        const motivo = (err as Error).message;
        const ritentabile = err instanceof ErrorePdf ? err.ritentabile : true;
        // Scansione senza testo: niente OCR a pagamento. L'atto resta in coda
        // ("needs_ocr", visibile su /aggiornamenti) per lo script OCR locale e,
        // se R2 e' attivo, il PDF viene archiviato per non perderlo.
        if (pdf && err instanceof ErrorePdf && !err.ritentabile && /OCR/i.test(motivo)) {
          rapporto.daOcr++;
          const motivoOcr = "PDF scansionato senza testo: in coda per l'OCR locale (scripts/ocr-locale.ts)";
          rapporto.voci.push({ ...base, esito: "needs_ocr", motivo: motivoOcr });
          if (!prova) {
            await registraVoce(db, {
              ...base, tipo: v.tipo, numero: v.numero, data: v.data, anno: v.anno,
              chiave: chiaveAtto(v.tipo, v.numero, v.anno, v.data),
              stato: "needs_ocr", motivo: motivoOcr, titolo: v.oggetto || v.titoloFonte, cartella: fonte.cartella,
            });
            await db.execute({ sql: `UPDATE aggiornamenti_voci SET tentativi = ? WHERE url = ?`, args: [MAX_TENTATIVI, v.url] });
            if (r2Configurato()) {
              const a = await archiviaPdf(db, { url: v.url, pdf, anno: v.anno, nome: `${fonte.abbrev}${v.numero ? ` ${v.numero}` : ""} - ${v.oggetto || v.titoloFonte}`, stato: "needs_ocr" });
              if (a.ok) rapporto.archiviati++;
              else if (a.motivo) rapporto.dettagliErrori.push(`archivio di "${v.titoloFonte}": ${a.motivo}`);
            }
          }
          continue;
        }
        rapporto.errori++;
        rapporto.dettagliErrori.push(`${v.titoloFonte}: ${motivo}`);
        rapporto.voci.push({ ...base, esito: "errore", motivo });
        if (!prova) {
          await registraVoce(db, {
            ...base, tipo: v.tipo, numero: v.numero, data: v.data, anno: v.anno,
            chiave: chiaveAtto(v.tipo, v.numero, v.anno, v.data),
            stato: "errore", motivo, incrementaTentativi: true,
          });
          // Errore definitivo (es. scansione senza testo): niente altri tentativi.
          if (!ritentabile) {
            await db.execute({ sql: `UPDATE aggiornamenti_voci SET tentativi = ? WHERE url = ?`, args: [MAX_TENTATIVI, v.url] });
          }
        }
        continue;
      }

      const valutazione = valutaTesto(estratto.testo, meta);
      if (!valutazione.pertinente) {
        rapporto.scartati++;
        rapporto.voci.push({ ...base, esito: "non_pertinente", motivo: valutazione.motivo });
        if (!prova) {
          await registraVoce(db, {
            ...base, tipo: v.tipo, numero: v.numero, data: v.data, anno: v.anno,
            chiave: chiaveAtto(v.tipo, v.numero, v.anno, v.data),
            stato: "non_pertinente", motivo: valutazione.motivo, punteggio: valutazione.punteggio, sha256: estratto.sha256,
          });
        }
        continue;
      }
      rapporto.pertinenti++;

      // Estremi: per i provvedimenti il numero e' il protocollo nel PDF.
      let numero = v.numero;
      let anno = v.anno;
      if (v.tipo === "provvedimento") {
        const prot = estraiProtocollo(estratto.testo);
        if (prot) {
          numero = prot.numero;
          anno = anno ?? prot.anno;
        }
      }
      anno = anno ?? new Date().getUTCFullYear();
      const chiave = chiaveAtto(v.tipo, numero, anno, v.data);

      // Deduplica contro il corpus esistente.
      const duplicato = await cercaDuplicato(db, v.tipo, numero, anno, v.url, v.oggetto);
      if (duplicato) {
        rapporto.duplicati++;
        const motivo = `già presente nel corpus (documento #${duplicato})`;
        rapporto.voci.push({ ...base, esito: "duplicato", motivo, docId: duplicato });
        if (!prova) {
          await registraVoce(db, {
            ...base, tipo: v.tipo, numero, data: v.data, anno, chiave,
            stato: "duplicato", motivo, punteggio: valutazione.punteggio, docId: duplicato, sha256: estratto.sha256,
          });
        }
        continue;
      }

      const oggetto = await oggettoConciso(v.oggetto, estratto.testo);
      // Senza numero/protocollo l'atto si distingue per data ("Prov. del 03/11/2026").
      const dataBreve = v.data ? v.data.split("-").reverse().join("/") : null;
      const titolo = numero
        ? `${fonte.abbrev} ${numero} - ${oggetto}`
        : dataBreve
          ? `${fonte.abbrev} del ${dataBreve} - ${oggetto}`
          : `${fonte.abbrev} - ${oggetto}`;

      if (prova) {
        rapporto.voci.push({ ...base, esito: "da_importare", motivo: valutazione.motivo, titolo });
        continue;
      }

      try {
        const docId = await inserisciDocumento(db, {
          cartella: fonte.cartella,
          nomeFile: v.url,
          titolo,
          anno,
          testo: estratto.testo,
          tipo: v.tipo,
          numero,
          data: v.data,
          sha256: estratto.sha256,
        });
        rapporto.importati++;
        rapporto.idImportati.push(docId);
        if (pdf && r2Configurato()) {
          const a = await archiviaPdf(db, { url: v.url, pdf, sha256: estratto.sha256, anno, nome: titolo, docId, stato: "importato" });
          if (a.ok) rapporto.archiviati++;
          else if (a.motivo) rapporto.dettagliErrori.push(`archivio di "${titolo}": ${a.motivo}`);
        }
        notiCron.set(docId, { tipo: TIPO_CRON[v.tipo], numero, data: v.data });
        await registraVoce(db, {
          ...base, tipo: v.tipo, numero, data: v.data, anno, chiave,
          stato: "importato", motivo: valutazione.motivo, punteggio: valutazione.punteggio,
          docId, sha256: estratto.sha256, titolo, cartella: fonte.cartella, testo: estratto.testo,
        });
        rapporto.voci.push({ ...base, esito: "importato", motivo: valutazione.motivo, titolo, docId });
      } catch (err) {
        rapporto.errori++;
        const motivo = `inserimento nel corpus non riuscito: ${(err as Error).message}`;
        rapporto.dettagliErrori.push(`${v.titoloFonte}: ${motivo}`);
        rapporto.voci.push({ ...base, esito: "errore", motivo });
        await registraVoce(db, {
          ...base, tipo: v.tipo, numero, data: v.data, anno, chiave, stato: "errore", motivo, incrementaTentativi: true,
        }).catch(() => undefined);
      }
    }

    // 6) Indicizzazione semantica: prima gli atti appena importati, poi gli
    //    arretrati (budget di neuroni e tetto di dimensioni in lib/ai/indice.ts).
    if (!prova && Date.now() - t0 < budget) {
      try {
        const ri = await indicizzaImportati(db, rapporto.idImportati, Math.max(10_000, budget - (Date.now() - t0) - 20_000));
        rapporto.indicizzati = ri.documenti;
        if (ri.arresto && !/tempo dell'esecuzione/.test(ri.arresto) && !/non configurato/.test(ri.arresto)) {
          rapporto.dettagliErrori.push(`indicizzazione semantica: ${ri.arresto}`);
        }
      } catch (err) {
        rapporto.dettagliErrori.push(`indicizzazione semantica: ${(err as Error).message}`);
      }
    }

    // 7) Metadati normalizzati (anni, tipologie, estremi, duplicati) dei
    //    documenti nuovi o non ancora trattati (anche dopo una reimportazione).
    if (!prova && Date.now() - t0 < budget) {
      try {
        await assicuraSchemaMetadati(db);
        const rs = await db.execute({
          sql: `SELECT d.id FROM documenti d LEFT JOIN documenti_meta m ON m.doc_id = d.id
                WHERE m.doc_id IS NULL OR m.revisione < ? ORDER BY d.id LIMIT 600`,
          args: [REVISIONE_REGOLE],
        });
        const ids = rs.rows.map((r) => Number(r.id));
        if (ids.length) {
          const b = await eseguiBonifica(db, { applica: true, ids, noti: notiCron, budgetMs: Math.max(5_000, budget - (Date.now() - t0)) });
          rapporto.metadatiNormalizzati = b.esaminati;
        }
      } catch (err) {
        rapporto.dettagliErrori.push(`normalizzazione dei metadati: ${(err as Error).message}`);
      }
    }

    // 8) Argomenti seguiti (watchlist) e dossier dello Studio in cache: i
    //    nuovi atti pertinenti vengono segnalati (badge, pagina, webhook).
    if (!prova && rapporto.idImportati.length) {
      try {
        rapporto.watchlist = await confrontaNuoviAtti(db, rapporto.idImportati);
      } catch (err) {
        rapporto.dettagliErrori.push(`confronto con gli argomenti seguiti: ${(err as Error).message}`);
      }
    }

    // 9) Esito complessivo.
    const fontiOk = rapporto.fonti.filter((f) => f.ok).length;
    const fontiKo = rapporto.fonti.length - fontiOk;
    if (fontiOk === 0) rapporto.esito = "errore";
    else if (fontiKo > 0 || rapporto.errori > 0) rapporto.esito = "parziale";
    else if (rapporto.importati > 0 || (prova && rapporto.voci.some((v) => v.esito === "da_importare"))) rapporto.esito = "ok";
    else rapporto.esito = "nessuna_novita";
    rapporto.messaggio = componiMessaggio(rapporto, fontiOk);
  } catch (err) {
    rapporto.esito = "errore";
    rapporto.messaggio = `Errore inatteso: ${(err as Error).message}`;
    rapporto.dettagliErrori.push(rapporto.messaggio);
    console.error("[aggiornamenti] errore inatteso:", err);
  }

  rapporto.durataMs = Date.now() - t0;
  if (!prova && rapporto.id !== null) {
    try {
      await chiudiEsecuzione(db, rapporto.id, {
        esito: rapporto.esito,
        durataMs: rapporto.durataMs,
        fontiControllate: rapporto.fonti.length,
        fontiInErrore: rapporto.fonti.filter((f) => !f.ok).length,
        vociLette: rapporto.vociLette,
        nuoveVoci: rapporto.nuoveVoci,
        pertinenti: rapporto.pertinenti,
        importati: rapporto.importati,
        duplicati: rapporto.duplicati,
        scartati: rapporto.scartati,
        errori: rapporto.errori,
        messaggio: rapporto.messaggio,
        dettagli: {
          fonti: rapporto.fonti,
          errori: rapporto.dettagliErrori.slice(0, 40),
          voci: rapporto.voci.slice(0, 80),
          ripristinati: rapporto.ripristinati,
          indicizzati: rapporto.indicizzati,
        },
      });
    } catch (err) {
      console.error("[aggiornamenti] chiusura del registro non riuscita:", err);
    }
  }
  return rapporto;
}

const atti = (n: number) => `${n} ${n === 1 ? "atto" : "atti"}`;

function componiMessaggio(r: RapportoEsecuzione, fontiOk: number): string {
  const parti: string[] = [];
  parti.push(`${fontiOk}/${r.fonti.length} fonti lette, ${atti(r.vociLette)} in elenco, ${r.nuoveVoci} mai ${r.nuoveVoci === 1 ? "visto" : "visti"} prima.`);
  if (r.prova) {
    const da = r.voci.filter((v) => v.esito === "da_importare").length;
    parti.push(`Prova a secco: ${atti(da)} da importare, ${r.duplicati} già presenti, ${r.scartati} non pertinenti.`);
  } else if (r.importati > 0) {
    parti.push(r.importati === 1 ? "Importato 1 nuovo atto catastale." : `Importati ${r.importati} nuovi atti catastali.`);
  } else {
    parti.push("Nessun nuovo atto catastale da importare.");
  }
  if (r.duplicati) parti.push(`${atti(r.duplicati)} già nel corpus.`);
  if (r.ripristinati) parti.push(`Ripristinati ${atti(r.ripristinati)} importati in precedenza e spariti dal corpus.`);
  if (r.errori) parti.push(`${r.errori} ${r.errori === 1 ? "errore" : "errori"} (ritentati alla prossima esecuzione).`);
  if (r.daOcr) parti.push(`${atti(r.daOcr)} ${r.daOcr === 1 ? "scansionato" : "scansionati"} in coda per l'OCR locale (npm run ocr:locale).`);
  if (r.archiviati) parti.push(`${r.archiviati} PDF ${r.archiviati === 1 ? "archiviato" : "archiviati"} su R2.`);
  if (r.metadatiNormalizzati) parti.push(`Metadati normalizzati: ${atti(r.metadatiNormalizzati)}.`);
  const seguiti = r.watchlist?.argomenti.length ?? 0;
  if (seguiti) parti.push(`Novità per ${seguiti} ${seguiti === 1 ? "argomento seguito" : "argomenti seguiti"}.`);
  const dossier = r.watchlist?.dossierSegnalati.length ?? 0;
  if (dossier) parti.push(`${dossier} ${dossier === 1 ? "dossier dello Studio segnalato" : "dossier dello Studio segnalati"} per la rigenerazione.`);
  const ko = r.fonti.filter((f) => !f.ok);
  if (ko.length) parti.push(`Fonti con problemi: ${ko.map((f) => `${f.nome} (${f.errore ?? "errore"})`).join("; ")}.`);
  return parti.join(" ");
}

/**
 * Notifica opzionale (webhook compatibile Slack/Discord/Teams): solo quando
 * c'e' qualcosa da sapere, cioe' novita' importate o un problema.
 */
export async function notifica(r: RapportoEsecuzione): Promise<void> {
  const url = process.env.AGGIORNAMENTI_WEBHOOK_URL;
  if (!url || r.prova) return;
  if (r.importati === 0 && r.daOcr === 0 && (r.esito === "ok" || r.esito === "nessuna_novita" || r.esito === "saltata")) return;
  const titoli = r.voci.filter((v) => v.esito === "importato").map((v) => `• ${v.titolo}`).join("\n");
  const seguiti = (r.watchlist?.argomenti ?? [])
    .map((a) => `★ ${a.argomento} (${a.atti.length} ${a.atti.length === 1 ? "atto" : "atti"}): ${a.atti.map((x) => x.titolo).join("; ")}`)
    .join("\n");
  const dossier = (r.watchlist?.dossierSegnalati ?? []).map((d) => d.argomento).join(", ");
  const testo =
    `FontiCatastali — aggiornamento ${r.esito.toUpperCase()}\n${r.messaggio}${titoli ? `\n${titoli}` : ""}` +
    `${seguiti ? `\nNovità sugli argomenti seguiti:\n${seguiti}` : ""}` +
    `${dossier ? `\nDossier dello Studio da rigenerare: ${dossier}` : ""}` +
    `\nhttps://fonti-catastali.vercel.app/aggiornamenti`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: testo, content: testo.slice(0, 1900), argomenti: r.watchlist?.argomenti ?? [], dossier: r.watchlist?.dossierSegnalati ?? [] }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.warn("[aggiornamenti] notifica webhook non riuscita:", (err as Error).message);
  }
}
