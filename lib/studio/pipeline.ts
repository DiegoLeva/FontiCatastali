import { getDb } from "@/lib/db";
import { chatJson, quotaAiEsaurita, quotaEsaurita, ripristinoQuota } from "@/lib/cloudflare";
import { conServizioAi, disponibili, MARGINE, type TettoLocale } from "@/lib/ai/budget";
import { TETTO_DOSSIER } from "./limiti";
import { concettoDaTermine, espandiArgomento, unioneFts, type Concetto } from "./espansione";
import {
  arricchisci,
  cercaConcetti,
  cercaSemantica,
  contaDocumenti,
  docUrl,
  estrattiAnalizzate,
  estrattiMenzioni,
  inParallelo,
  MAX_FONTI,
  selezionaAnalizzate,
  versioneCorpus,
  type Estratti,
} from "./recupero";
import { analizzaFonti, lotti, MODELLO_ANALISI, notaAutomatica, stimaMassimaAnalisi, type FontePerAnalisi } from "./analisi";
import {
  calcolaLacune,
  MODELLO_STESURA,
  pianoSezioni,
  riferimentiNonVerificati,
  scriviSezione,
  sezioneAvvertenze,
  stimaNeuroniStesura,
  validaCitazioni,
  type SezionePiano,
} from "./stesura";
import { leggiCache, salvaCache } from "./cache";
import type { ConcettoEspanso, Dossier, EventoStudio, FonteStudio, SezioneDossier, VoceTimeline } from "./tipi";

/**
 * Pipeline completa dello Studio Normativo:
 *
 *   espansione -> recupero esaustivo (FTS + semantico) -> estratti dai testi
 *   integrali -> analisi strutturata a lotti (map) -> stesura per sezioni in
 *   streaming ordinato (reduce) -> verifiche anti-allucinazione -> cache.
 *
 * `emit` riceve gli eventi da inoltrare al client (NDJSON). La pipeline non
 * lancia mai eccezioni verso il chiamante per errori del modello: degrada
 * (note automatiche, sezione segnalata come non riuscita) e lo dice.
 */

const SCHEMA_TERMINI = {
  type: "object",
  properties: { termini: { type: "array", items: { type: "string" } } },
  required: ["termini"],
};

async function espansioneAi(argomento: string, signal?: AbortSignal): Promise<string[]> {
  const r = (await chatJson(
    [
      { role: "system", content: "Sei un esperto di terminologia della normativa e prassi catastale italiana (Agenzia delle Entrate, ex Agenzia del Territorio). Rispondi solo in JSON." },
      {
        role: "user",
        content: `Per l'argomento di studio «${argomento}» elenca fino a 10 espressioni (sinonimi tecnici, diciture ufficiali, sigle, procedure o modelli, istituti strettamente collegati) che compaiono nelle circolari, risoluzioni e provvedimenti catastali italiani. Espressioni brevi (1-4 parole), in italiano, senza spiegazioni.\nFormato: {"termini": ["...", "..."]}`,
      },
    ],
    SCHEMA_TERMINI,
    { maxTokens: 300, temperature: 0.2, timeoutMs: 9_000, signal }
  )) as { termini?: unknown };
  return Array.isArray(r?.termini) ? r.termini.map((t) => String(t)).slice(0, 12) : [];
}

const raggruppa = (id: string) => (id.startsWith("evoluzione") ? "evoluzione" : id);

/** Termini istituzionali troppo generici per caratterizzare un argomento. */
const GENERICI = new Set([
  "agenzia delle entrate", "agenzia del territorio", "catasto", "catasto terreni", "catasto fabbricati",
  "catasto dei terreni", "catasto dei fabbricati", "catasto urbano", "nuovo catasto edilizio urbano",
  "ufficio provinciale", "uffici provinciali", "ministero delle finanze", "normativa catastale",
  "banca dati", "banca dati catastale", "servizi catastali", "documenti catastali", "modelli catastali",
  "atti catastali", "dati catastali", "immobili", "fabbricati", "terreni", "decreto", "legge",
  "circolare", "risoluzione", "provvedimento", "prassi", "normativa",
]);
const normTermine = (t: string) => t.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim();

/** Anni citati nel testo di una fonte (per riconoscere metadati incoerenti). */
function annoMassimoCitato(testo: string): number {
  const limite = new Date().getUTCFullYear() + 1;
  let max = 0;
  for (const m of testo.matchAll(/(?<!\d)(18[5-9]\d|19\d\d|20[0-4]\d)(?!\d)/g)) {
    const a = Number(m[1]);
    if (a <= limite && a > max) max = a;
  }
  return max;
}

/** Quota del tetto riservata all'analisi: il resto e' per la stesura. */
const QUOTA_ANALISI = 0.55;

/**
 * Genera un dossier attribuendo ogni chiamata AI allo Studio e al tetto del
 * singolo dossier: oltre il tetto le chiamate non partono e la pipeline
 * degrada (note automatiche, capitoli non scritti) invece di spendere.
 */
export async function generaDossier(
  argomento: string,
  emit: (e: EventoStudio) => void,
  signal?: AbortSignal,
  opzioni: { tettoNeuroni?: number } = {}
): Promise<Dossier | null> {
  const tetto: TettoLocale = { nome: "questo dossier", limite: Math.min(TETTO_DOSSIER, opzioni.tettoNeuroni ?? TETTO_DOSSIER), usati: 0 };
  return conServizioAi("studio", () => generaDossierEntroTetto(argomento, emit, signal, tetto), tetto);
}

async function generaDossierEntroTetto(
  argomento: string,
  emit: (e: EventoStudio) => void,
  signal: AbortSignal | undefined,
  tetto: TettoLocale
): Promise<Dossier | null> {
  const t0 = Date.now();
  const db = getDb();
  // Budget di tempo (maxDuration = 300 s): l'analisi si ferma a 150 s (le fonti
  // rimaste ricevono la nota automatica), la stesura a 270 s. Cosi' il client
  // riceve sempre l'evento finale prima che Vercel termini la funzione.
  // `signal` resta quello del client (abbandono = si smette di emettere).
  const conScadenza = (ms: number) => {
    const scadenza = AbortSignal.timeout(Math.max(1_000, ms - (Date.now() - t0)));
    return signal ? AbortSignal.any([signal, scadenza]) : scadenza;
  };
  const avvisi: string[] = [];
  let chiamateAi = 0;
  const haAi = !!(process.env.CF_ACCOUNT_ID && process.env.CF_API_TOKEN);
  const avvisa = (m: string, grave = false) => {
    avvisi.push(m);
    emit(grave ? { tipo: "avviso", messaggio: m, grave } : { tipo: "avviso", messaggio: m });
  };
  // Quota giornaliera di Workers AI esaurita: niente analisi ne' stesura con
  // il modello (fallirebbero tutte), ma fonti, estratti e timeline restano.
  let aiEsaurita = false;
  const messaggioQuota = () =>
    `Budget AI gratuito di oggi esaurito: fino alle ${ripristinoQuota().ora} (ora italiana), quando si azzera, il modello non può analizzare le fonti né scrivere i capitoli.`;

  /* ----------------------------- 1. Espansione ---------------------------- */
  const piano = espandiArgomento(argomento);
  emit({ tipo: "fase", fase: "espansione", messaggio: "Espansione dell'argomento: radici, sinonimi tecnici e diciture catastali…" });

  const pVersione = versioneCorpus(db);
  const pSemantica = haAi
    ? cercaSemantica(`${piano.argomento}. ${piano.concetti.slice(0, 8).map((c) => c.etichetta).join(", ")}`).catch((err) => {
        if (quotaEsaurita(err)) aiEsaurita = true;
        else avvisa(`Ricerca semantica non disponibile (${(err as Error).message.slice(0, 80)}): uso la sola ricerca testuale.`);
        return new Map<number, number>();
      })
    : Promise.resolve(new Map<number, number>());

  let terminiAi: string[] = [];
  if (haAi) {
    try {
      chiamateAi++;
      terminiAi = await espansioneAi(piano.argomento, signal);
    } catch (err) {
      /* espansione AI facoltativa */
      if (quotaEsaurita(err)) aiEsaurita = true;
    }
  }
  const versione = await pVersione;
  const esistenti = new Set(piano.concetti.map((c) => c.fts));
  const proposte: Concetto[] = [];
  for (const t of terminiAi) {
    if (GENERICI.has(normTermine(t))) continue;
    const c = concettoDaTermine(t);
    if (c && !esistenti.has(c.fts)) {
      esistenti.add(c.fts);
      proposte.push(c);
    }
  }
  // Un termine proposto dal modello entra solo se esiste davvero nel corpus e
  // non e' generico (al massimo il 6% dei documenti): sul corpus reale il
  // modello proponeva per "volture" anche "Agenzia delle Entrate" (418 doc).
  const conteggiAi = await inParallelo(proposte, 6, (c) => contaDocumenti(db, c.fts));
  const tettoGenerici = Math.max(25, Math.round(versione.documenti * 0.06));
  const validati = proposte
    .filter((_, i) => conteggiAi[i] > 0 && conteggiAi[i] <= tettoGenerici)
    .map((c) => ({ ...c, peso: 0.4 }))
    .slice(0, 8);
  const concetti = [...piano.concetti, ...validati];
  if (!concetti.length) {
    emit({ tipo: "errore", messaggio: "L'argomento non contiene termini ricercabili: prova con parole più specifiche." });
    return null;
  }

  /* ------------------------------ 2. Ricerca ------------------------------ */
  emit({ tipo: "fase", fase: "ricerca", messaggio: `Ricerca esaustiva nel database con ${concetti.length} concetti…` });
  const recupero = await cercaConcetti(db, concetti);
  recupero.avvisi.forEach((m) => avvisa(m));
  const semantica = await pSemantica;
  if (aiEsaurita) {
    // Un "Rigenera" con la quota esaurita non deve sostituire la versione
    // completa gia' salvata con una senza capitoli: si mostra quella.
    const salvato = await leggiCache(db, piano.chiave);
    if (salvato) {
      emit({ tipo: "avviso", grave: true, messaggio: `${messaggioQuota()} Ti mostro l'ultima versione completa salvata: potrai rigenerarla dopo l'azzeramento.` });
      emit({ tipo: "fine", dossier: salvato, cache: true });
      return salvato;
    }
    avvisa(`${messaggioQuota()} Qui sotto trovi comunque tutte le fonti trovate nel database (ricerca solo testuale), con estratti e timeline; il dossier completo si potrà generare dopo l'azzeramento.`, true);
  }
  let usaAi = haAi && !aiEsaurita;
  // Fonti intercettate SOLO da termini proposti dal modello: rumore, a meno
  // che anche il canale semantico non le riconosca come pertinenti.
  const origine = new Map(concetti.map((c) => [c.etichetta, c.origine]));
  for (const [id, c] of recupero.candidati) {
    const soloAi = c.concetti.size > 0 && [...c.concetti.keys()].every((k) => origine.get(k) === "ai");
    if (soloAi && (semantica.get(id) ?? 0) < 0.6) recupero.candidati.delete(id);
  }
  const espansione: ConcettoEspanso[] = concetti.map((c) => ({
    etichetta: c.etichetta,
    espressione: c.fts,
    origine: c.origine,
    peso: c.peso,
    documenti: recupero.conteggi.get(c.etichetta) ?? 0,
  }));
  const evidenzia = concetti.map((c) => c.regex);
  emit({ tipo: "espansione", concetti: espansione, evidenzia });

  const ordinati = await arricchisci(db, recupero.candidati, semantica, concetti);
  if (!ordinati.length) {
    emit({ tipo: "errore", messaggio: `Nel database non risultano fonti su «${piano.argomento}». Prova con un sinonimo o con il nome dell'istituto (es. "voltura", "tipo mappale", "F/2").` });
    return null;
  }
  const elencati = ordinati.slice(0, MAX_FONTI);
  if (ordinati.length > MAX_FONTI) avvisa(`Trovate ${ordinati.length} fonti: l'indice mostra le ${MAX_FONTI} più pertinenti.`);
  const daAnalizzare = selezionaAnalizzate(elencati);
  // Piano entro il tetto: l'analisi (caso peggiore) non supera il 55% del
  // budget del dossier; se servisse, le fonti meno pertinenti restano menzioni.
  if (usaAi) {
    const perPunteggio = elencati.filter((c) => daAnalizzare.has(c.id)).sort((a, b) => a.punteggio - b.punteggio);
    let tagliate = 0;
    while (daAnalizzare.size > 12 && stimaMassimaAnalisi(daAnalizzare.size) * MARGINE > tetto.limite * QUOTA_ANALISI) {
      const c = perPunteggio.shift();
      if (!c) break;
      daAnalizzare.delete(c.id);
      tagliate++;
    }
    if (tagliate) avvisa(`Per restare nel budget di neuroni del dossier, ${tagliate} fonti meno pertinenti restano tra le menzioni.`);
  }

  // Numerazione cronologica: [F1] e' la fonte piu' antica; le non datate in fondo.
  const cronologico = [...elencati].sort(
    (a, b) =>
      (a.anno === "0000" ? 1 : 0) - (b.anno === "0000" ? 1 : 0) || a.anno.localeCompare(b.anno) || b.punteggio - a.punteggio
  );
  const fonti: FonteStudio[] = cronologico.map((c, i) => ({
    n: i + 1,
    id: c.id,
    titolo: c.titolo,
    anno: c.anno,
    cartella: c.cartella,
    tipo: c.tipo,
    url: docUrl(c.cartella, c.nomeFile),
    ...(c.estremi ? { estremi: c.estremi } : {}),
    livello: daAnalizzare.has(c.id) ? "analizzata" : "menzione",
    punteggio: c.punteggio,
    concetti: [...c.concetti.keys()].slice(0, 8),
    inTitolo: c.inTitolo,
    semantica: c.semantica > 0,
    passaggi: [],
  }));
  const analizzate = fonti.filter((f) => f.livello === "analizzata");
  const menzioni = fonti.filter((f) => f.livello === "menzione");
  const perTipo: Record<string, number> = {};
  for (const f of fonti) perTipo[f.tipo] = (perTipo[f.tipo] ?? 0) + 1;
  const anni = fonti.map((f) => f.anno).filter((a) => a !== "0000").sort();
  const statBase = {
    trovate: ordinati.length,
    analizzate: analizzate.length,
    menzioni: menzioni.length,
    perTipo,
    daAnno: anni[0] ?? null,
    aAnno: anni[anni.length - 1] ?? null,
  };
  emit({ tipo: "fonti", fonti, statistiche: statBase });
  emit({
    tipo: "fase",
    fase: "ricerca",
    messaggio: `Trovate ${ordinati.length} fonti nel database${statBase.daAnno ? ` (${statBase.daAnno}–${statBase.aAnno})` : ""}: ${analizzate.length} da analizzare in dettaglio, ${menzioni.length} menzioni.`,
  });

  /* ------------------------------ 3. Estratti ----------------------------- */
  emit({ tipo: "fase", fase: "estratti", messaggio: "Lettura dei testi integrali ed estrazione dei passaggi pertinenti…" });
  const [estrA, estrM] = await Promise.all([
    estrattiAnalizzate(db, analizzate.map((f) => f.id), concetti),
    estrattiMenzioni(db, menzioni.map((f) => f.id), unioneFts(concetti.filter((c) => c.peso >= 0.6).slice(0, 14))),
  ]);
  const vuoto: Estratti = { incipit: "", passaggi: [], occorrenze: 0 };
  for (const f of analizzate) f.passaggi = estrA.get(f.id)?.passaggi ?? [];
  for (const f of menzioni) {
    const s = estrM.get(f.id);
    f.passaggi = s ? [s] : [];
  }
  // Metadati incoerenti: il testo cita anni successivi a quello registrato.
  const dubbi: string[] = [];
  for (const f of analizzate) {
    const a = Number(f.anno);
    const e = estrA.get(f.id);
    const max = annoMassimoCitato(`${e?.incipit ?? ""} ${f.passaggi.join(" ")}`);
    if (a > 0 && max > a + 3) {
      f.annoDubbio = max;
      dubbi.push(`[F${f.n}] ${f.anno}→${max}`);
    }
  }
  if (dubbi.length) {
    avvisa(`${dubbi.length} fonti hanno nel database un anno probabilmente errato (il testo cita anni successivi): ${dubbi.slice(0, 6).join(", ")}${dubbi.length > 6 ? "…" : ""}. Restano nella loro posizione, segnalate.`);
  }

  /* ------------------------------ 4. Analisi ------------------------------ */
  const perAnalisi: FontePerAnalisi[] = analizzate.map((f) => ({
    n: f.n,
    titolo: f.titolo,
    tipo: f.tipo,
    anno: f.anno,
    cartella: f.cartella,
    estratti: estrA.get(f.id) ?? vuoto,
  }));
  const nLotti = lotti(perAnalisi).length;
  emit({
    tipo: "fase",
    fase: "analisi",
    messaggio: `Ricostruzione cronologica: analisi di ${analizzate.length} fonti in ${nLotti} lotti…`,
    progresso: 0,
  });
  if (usaAi) {
    try {
      const esito = await analizzaFonti(
        piano.argomento,
        perAnalisi,
        (note, fatte) => {
          emit({ tipo: "note", note, fatte, totali: analizzate.length });
          emit({ tipo: "fase", fase: "analisi", messaggio: `Ricostruzione cronologica: ${fatte}/${analizzate.length} fonti analizzate…`, progresso: fatte / analizzate.length });
        },
        conScadenza(150_000)
      );
      chiamateAi += esito.chiamate;
      for (const f of analizzate) f.nota = esito.note.get(f.n);
      if (esito.automatiche) avvisa(`${esito.automatiche} fonti sono state sintetizzate senza modello (nota estratta direttamente dal testo).`);
      if (esito.budgetEsaurito) aiEsaurita = true;
    } catch (err) {
      if (signal?.aborted) return null;
      avvisa(`Analisi con il modello non riuscita (${(err as Error).message.slice(0, 90)}): note estratte direttamente dai testi.`);
    }
  } else if (!haAi) {
    avvisa("Modello linguistico non configurato: note estratte direttamente dai testi, stesura non disponibile.");
  }
  for (const f of analizzate) if (!f.nota) f.nota = notaAutomatica(perAnalisi.find((p) => p.n === f.n)!);
  if (!usaAi) emit({ tipo: "note", note: analizzate.map((f) => ({ n: f.n, nota: f.nota! })), fatte: analizzate.length, totali: analizzate.length });
  // Quota esaurita durante l'analisi (anche da un'altra richiesta: e' per
  // account): la stesura fallirebbe capitolo per capitolo, quindi si salta.
  if (usaAi && (quotaAiEsaurita() || aiEsaurita)) {
    usaAi = false;
    avvisa(`${messaggioQuota()} Il budget si è esaurito durante la generazione: le fonti non ancora analizzate hanno una nota estratta dal testo e i capitoli non sono stati scritti.`, true);
  }

  /* ------------------------------ 5. Stesura ------------------------------ */
  emit({ tipo: "fase", fase: "stesura", messaggio: usaAi ? "Stesura del dossier per capitoli…" : "Riepilogo delle fonti senza stesura (modello non disponibile)…" });
  const valide = new Set(analizzate.map((f) => f.n));
  const sezioni: SezioneDossier[] = [];
  const citate = new Set<number>();
  let citTot = 0;
  let citOk = 0;
  let citRimosse = 0;
  let sezioniRiuscite = 0;

  let pianoS: SezionePiano[] = usaAi ? pianoSezioni(piano.argomento, analizzate) : [];
  // La stesura parte solo se ci sta per intero (nel tetto del dossier e nel
  // budget di oggi): meglio nessun capitolo che capitoli a meta'.
  if (pianoS.length) {
    const servono = stimaNeuroniStesura(pianoS) * MARGINE;
    const residuo = Math.min(tetto.limite - tetto.usati, await disponibili("studio").catch(() => 0));
    if (servono > residuo) {
      const fattore = residuo / servono;
      if (fattore >= 0.6) {
        pianoS = pianoS.map((s) => ({ ...s, maxTokens: Math.max(400, Math.floor(s.maxTokens * fattore * 0.95)) }));
        avvisa("Capitoli più brevi del solito per restare nel budget di neuroni del dossier.");
      } else {
        pianoS = [];
        usaAi = false;
        avvisa(`${messaggioQuota()} Il budget residuo non basta per scrivere i capitoli: restano fonti, note e timeline.`, true);
      }
    }
  }
  const stato = pianoS.map(() => ({ pezzi: [] as string[], finito: false, testo: "", parziale: "", ok: false }));
  let attivo = -1;
  const iniziate = new Set<string>();

  const intestazioneParte = (i: number) => {
    const s = pianoS[i];
    return s.sottotitolo ? `${i > 0 && raggruppa(pianoS[i - 1].id) === "evoluzione" ? "\n\n" : ""}### ${s.sottotitolo}\n\n` : "";
  };
  const chiudiGruppo = (i: number) => {
    const g = raggruppa(pianoS[i].id);
    if (i + 1 < pianoS.length && raggruppa(pianoS[i + 1].id) === g) return;
    const parti = pianoS.map((s, k) => ({ s, k })).filter(({ s }) => raggruppa(s.id) === g);
    const md = parti.map(({ s, k }) => (s.sottotitolo ? `### ${s.sottotitolo}\n\n${stato[k].testo}` : stato[k].testo)).join("\n\n");
    const v = validaCitazioni(md, valide);
    citTot += v.totali;
    citOk += v.valide;
    citRimosse += v.rimosse;
    v.citate.forEach((n) => citate.add(n));
    sezioni.push({ id: g, titolo: pianoS[i].titolo, markdown: v.md });
    emit({ tipo: "sezione_fine", id: g, markdown: v.md });
  };
  const avanza = () => {
    for (;;) {
      if (attivo >= pianoS.length) return;
      if (attivo >= 0 && !stato[attivo].finito) return;
      if (attivo >= 0) chiudiGruppo(attivo);
      attivo++;
      if (attivo >= pianoS.length) return;
      const g = raggruppa(pianoS[attivo].id);
      if (!iniziate.has(g)) {
        iniziate.add(g);
        emit({ tipo: "sezione_inizio", id: g, titolo: pianoS[attivo].titolo });
      }
      const testa = intestazioneParte(attivo);
      if (testa) emit({ tipo: "delta", id: g, testo: testa });
      for (const p of stato[attivo].pezzi) emit({ tipo: "delta", id: g, testo: p });
      stato[attivo].pezzi = [];
    }
  };
  avanza();

  const scadenzaStesura = conScadenza(270_000);
  await inParallelo(pianoS, 6, async (s, i) => {
    if (signal?.aborted) return;
    try {
      const r = await scriviSezione(
        s,
        (t) => {
          stato[i].parziale += t;
          if (i === attivo) emit({ tipo: "delta", id: raggruppa(s.id), testo: t });
          else stato[i].pezzi.push(t);
        },
        scadenzaStesura
      );
      chiamateAi += r.chiamate;
      stato[i].testo = r.testo;
      stato[i].ok = r.testo.length > 0;
    } catch (err) {
      if (signal?.aborted) return;
      const motivo = scadenzaStesura.aborted
        ? "tempo massimo raggiunto"
        : quotaEsaurita(err)
          ? "budget AI esaurito"
          : (err as Error).message.slice(0, 120);
      stato[i].testo = `${stato[i].parziale.trim() ? `${stato[i].parziale.trim()}\n\n` : ""}_Stesura di questa parte non completata (${motivo}). Le fonti restano consultabili nella timeline e nell'indice: usa "Rigenera" per riprovare._`;
      avvisi.push(`Una parte del dossier ("${s.titolo}${s.sottotitolo ? ` ${s.sottotitolo}` : ""}") non è stata scritta.`);
    }
    stato[i].finito = true;
    if (stato[i].ok) sezioniRiuscite++;
    if (i === attivo) avanza();
  });
  if (signal?.aborted) return null;
  avanza();

  // Sezione finale deterministica (nessun modello): superate, lacune, copertura.
  const lacune = calcolaLacune(analizzate, fonti);
  const avvertenze = validaCitazioni(sezioneAvvertenze(analizzate, menzioni.length, lacune), valide).md;
  emit({ tipo: "sezione_inizio", id: "avvertenze", titolo: "Norme superate, lacune e avvertenze" });
  emit({ tipo: "sezione_fine", id: "avvertenze", markdown: avvertenze });
  sezioni.push({ id: "avvertenze", titolo: "Norme superate, lacune e avvertenze", markdown: avvertenze });

  /* ------------------------------ 6. Verifiche ---------------------------- */
  emit({ tipo: "fase", fase: "verifica", messaggio: "Verifica delle citazioni e dei riferimenti normativi…" });
  const evidenza = analizzate
    .map((f) => {
      const e = estrA.get(f.id);
      return `${f.titolo} ${e?.incipit ?? ""} ${f.passaggi.join(" ")} ${f.nota?.estremi ?? ""} ${(f.nota?.rinvii ?? []).join(" ")}`;
    })
    .join("\n");
  const testoGenerato = sezioni.filter((s) => s.id !== "avvertenze").map((s) => s.markdown).join("\n");
  const nonVerificati = riferimentiNonVerificati(testoGenerato, evidenza);
  if (nonVerificati.length) avvisi.push(`${nonVerificati.length} riferimenti normativi del testo non compaiono negli estratti: sono evidenziati come da verificare.`);

  const timeline: VoceTimeline[] = analizzate
    .filter((f) => f.nota)
    .map((f) => ({ anno: f.anno, n: f.n, ruolo: f.nota!.ruolo, stato: f.nota!.stato, cambiamento: f.nota!.novita || f.nota!.sintesi }));

  const dossier: Dossier = {
    versione: 1,
    chiave: piano.chiave,
    argomento: piano.argomento,
    creatoIl: new Date().toISOString(),
    versioneCorpus: versione,
    espansione,
    evidenzia,
    fonti,
    sezioni,
    timeline,
    lacune,
    superate: analizzate.filter((f) => f.nota?.stato === "superato").map((f) => f.n),
    verifiche: {
      citazioniTotali: citTot,
      citazioniValide: citOk,
      citazioniRimosse: citRimosse,
      riferimentiNonVerificati: nonVerificati,
      fontiNonCitate: analizzate.filter((f) => !citate.has(f.n)).map((f) => f.n),
    },
    statistiche: {
      ...statBase,
      durataMs: Date.now() - t0,
      chiamateAi,
      neuroni: Math.round(tetto.usati),
      modello: MODELLO_STESURA === MODELLO_ANALISI ? MODELLO_STESURA : `${MODELLO_ANALISI} + ${MODELLO_STESURA}`,
    },
    avvisi,
  };

  // In cache solo dossier riusciti: un dossier degradato si rigenera alla prossima richiesta.
  const riuscito = usaAi && pianoS.length > 0 && sezioniRiuscite === pianoS.length;
  if (riuscito) await salvaCache(db, dossier);
  emit({ tipo: "fine", dossier, cache: false });
  return dossier;
}
