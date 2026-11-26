/**
 * Normalizzazione dei metadati di un documento del corpus (funzione PURA,
 * senza database): tipologia dell'atto, numero, data di emanazione, estremi
 * leggibili, anno corretto e titolo di ripiego per i titoli inservibili.
 *
 * Fonti, in ordine di affidabilita':
 *   1. l'intestazione dell'atto nelle prime righe del testo
 *      ("CIRCOLARE N. 7/2011 ... Roma, 18 novembre 2011",
 *       "DECRETO-LEGGE 6 dicembre 2011, n. 201", "MINISTERO ... DECRETO 27 maggio 2015");
 *   2. lo schema curato dei nomi file ("2011 - Circ. 7 - Oggetto.pdf");
 *   3. la cartella di origine.
 *
 * Regole PRUDENTI: l'anno si corregge solo con un'intestazione chiara e un
 * tipo coerente; commenti, raccolte, guide, corsi e simili non si toccano
 * (finiscono tra i casi da revisionare). Nessun nome file, nessuna cartella e
 * nessun testo vengono mai modificati: solo anno, titolo (se inservibile) e
 * colonne aggiuntive.
 */

export const REVISIONE_REGOLE = 1;

export interface DocMeta {
  id: number;
  cartella: string;
  nomeFile: string;
  titolo: string;
  anno: number;
  /** Primi ~2.500 caratteri del testo estratto. */
  testo: string;
}

export type Confidenza = "alta" | "media" | "bassa";

export interface Proposta {
  tipoAtto: string;
  origineTipo: "testo" | "titolo" | "cartella";
  numero: string | null;
  data: string | null;
  estremi: string | null;
  /** Correzione dell'anno (solo se diverso da quello registrato). */
  anno: { valore: number; confidenza: Confidenza; motivo: string } | null;
  /** Nuovo titolo (solo per titoli inservibili). */
  titolo: { valore: string; motivo: string } | null;
  /** Casi ambigui: segnalati, mai applicati. */
  revisione: string[];
}

/* -------------------------------------------------------------------------- */
/* Date                                                                        */
/* -------------------------------------------------------------------------- */

const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const DATA = `(?:\\d{1,2}\\s*(?:°|º)?\\s+(?:${MESI.join("|")})\\s+\\d{4}|\\d{1,2}[./-]\\d{1,2}[./-]\\d{4})`;
const RE_DATA = new RegExp(DATA, "i");
const ANNO_MIN = 1850;
const annoMax = () => new Date().getUTCFullYear();

/** "18 novembre 2011" / "18/11/2011" -> "2011-11-18" (null se non valida). */
export function dataIso(s: string): string | null {
  const t = s.toLowerCase().replace(/[°º]/g, "");
  let g: number, m: number, a: number;
  const testuale = t.match(new RegExp(`(\\d{1,2})\\s+(${MESI.join("|")})\\s+(\\d{4})`));
  if (testuale) {
    g = Number(testuale[1]);
    m = MESI.indexOf(testuale[2]) + 1;
    a = Number(testuale[3]);
  } else {
    const n = t.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
    if (!n) return null;
    g = Number(n[1]);
    m = Number(n[2]);
    a = Number(n[3]);
  }
  if (a < ANNO_MIN || a > annoMax() || m < 1 || m > 12 || g < 1 || g > 31) return null;
  const d = new Date(Date.UTC(a, m - 1, g));
  if (d.getUTCMonth() !== m - 1) return null;
  return `${a}-${String(m).padStart(2, "0")}-${String(g).padStart(2, "0")}`;
}

export function dataLeggibile(iso: string): string {
  const [a, m, g] = iso.split("-").map(Number);
  return `${g} ${MESI[m - 1]} ${a}`;
}

/* -------------------------------------------------------------------------- */
/* Tipologie                                                                   */
/* -------------------------------------------------------------------------- */

/** Tipologia fine -> tipo dello Studio (pesi, filtri dell'indice delle fonti). */
export const TIPO_STUDIO: Record<string, string> = {
  Legge: "Legge",
  "Articolo di legge": "Legge",
  "Decreto-legge": "Decreto",
  "Decreto legislativo": "Decreto",
  "D.P.R.": "Decreto",
  "Decreto ministeriale": "Decreto",
  "Regio decreto": "Decreto",
  Decreto: "Decreto",
  Circolare: "Circolare",
  Risoluzione: "Risoluzione",
  Provvedimento: "Provvedimento",
  Nota: "Nota",
  "Nota di chiarimento": "Chiarimento",
  "Comunicato stampa": "Comunicato",
  Direttiva: "Direttiva",
  Determinazione: "Determinazione",
  Istruzione: "Istruzioni",
  "Procedura operativa": "Procedura",
  Sentenza: "Sentenza",
  Massimario: "Massimario",
  Modulistica: "Modulistica",
  Guida: "Guida",
  "Linee guida": "Linee guida",
  Manuale: "Manuale",
  Slide: "Convegno",
  "Materiale didattico": "Corso",
  "Documento demaniale": "Demanio",
  Sanzioni: "Sanzioni",
  Allegato: "Scheda AdE",
  Accordo: "Scheda AdE",
  Tabella: "Scheda AdE",
  Documento: "Altro",
};

/** Abbreviazioni dello schema dei nomi file ("2011 - Circ. 7 - ..."). */
const ABBREVIAZIONI: Array<[RegExp, string]> = [
  [/^circ\.?$/i, "Circolare"],
  [/^ris\.?$/i, "Risoluzione"],
  [/^prov\.?$/i, "Provvedimento"],
  [/^chiar\.?$/i, "Nota di chiarimento"],
  [/^com\.?$/i, "Comunicato stampa"],
  [/^dir\.?$/i, "Direttiva"],
  [/^det\.?$/i, "Determinazione"],
  [/^istr\.?$/i, "Istruzione"],
  [/^nota$/i, "Nota"],
  [/^legge$/i, "Legge"],
  [/^(?:dl|decr\.?)$/i, "Decreto"],
  [/^po$/i, "Procedura operativa"],
  [/^sent\.?$/i, "Sentenza"],
  [/^sanz\.?$/i, "Sanzioni"],
  [/^mass\.?$/i, "Massimario"],
  [/^mod\.?$/i, "Modulistica"],
  [/^guida$/i, "Guida"],
  [/^lg$/i, "Linee guida"],
  [/^manuale$/i, "Manuale"],
  [/^slide$/i, "Slide"],
  [/^corso$/i, "Materiale didattico"],
  [/^dem\.?$/i, "Documento demaniale"],
];

const CARTELLE: Array<[RegExp, string]> = [
  [/chiariment/, "Nota di chiarimento"],
  [/circolar/, "Circolare"],
  [/comunicat/, "Comunicato stampa"],
  [/convegn|slide/, "Slide"],
  [/cors/, "Materiale didattico"],
  [/decret/, "Decreto"],
  [/demani/, "Documento demaniale"],
  [/determinazion/, "Determinazione"],
  [/direttiv/, "Direttiva"],
  [/guid/, "Guida"],
  [/istruzion/, "Istruzione"],
  [/^legg/, "Legge"],
  [/linee guida/, "Linee guida"],
  [/manual/, "Manuale"],
  [/massimar/, "Massimario"],
  [/modulistic/, "Modulistica"],
  [/^note$|^nota/, "Nota"],
  [/procedur/, "Procedura operativa"],
  [/provvediment/, "Provvedimento"],
  [/risoluzion/, "Risoluzione"],
  [/sanzion/, "Sanzioni"],
  [/sentenz/, "Sentenza"],
];

/** Cartelle di materiale divulgativo: il loro tipo non cambia con il testo. */
const DIVULGATIVE = /cors|slide|convegn|guid|manual|massimar|modulistic|linee guida|demani/;
/** Titoli di opere su altri atti: l'anno dell'atto citato non e' il loro. */
const OPERE_DERIVATE = /\b(?:comment|testo (?:coordinato|aggiornato|vigente)|coordinat[oa] con|aggiornat[oa] al|raccolt[ae]|antologi|compendi|vademecum|prontuario|massimario|guida|manuale|slide|corso|dispensa)/i;

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

function tipoDaCartella(cartella: string): string {
  const c = norm(cartella.replace(/^\s*\d+\s*-\s*/, ""));
  for (const [re, t] of CARTELLE) if (re.test(c)) return t;
  return "Documento";
}

/* -------------------------------------------------------------------------- */
/* Nome file curato: "AAAA - Abbr N - Oggetto (2).pdf"                         */
/* -------------------------------------------------------------------------- */

interface SchemaNome {
  anno: number | null;
  abbreviazione: string;
  numero: string | null;
  oggetto: string;
}

export function schemaNome(nomeFile: string): SchemaNome | null {
  if (/^https?:\/\//i.test(nomeFile)) return null;
  const base = nomeFile.replace(/\.pdf$/i, "").replace(/\s*\(\d+\)$/, "").trim();
  const m = base.match(/^(\d{4}|s\.d\.)\s+-\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.]*)\s*(\d+(?:\s?[A-Z])?)?\s+-\s+(.+)$/);
  if (!m) return null;
  const anno = /^\d{4}$/.test(m[1]) ? Number(m[1]) : null;
  return { anno: anno && anno >= ANNO_MIN ? anno : null, abbreviazione: m[2], numero: m[3]?.replace(/\s+/g, "") ?? null, oggetto: m[4].trim() };
}

function tipoDaAbbreviazione(abbr: string): string | null {
  for (const [re, t] of ABBREVIAZIONI) if (re.test(abbr.trim())) return t;
  return null;
}

/** Tipologia dal titolo libero ("Circolare n. 2 del ...", "Dl 06122011 n201", "Provvedimento_26.01.2021"). */
function tipoDaTitoloLibero(titolo: string): string | null {
  const t = norm(titolo).replace(/[_]+/g, " ");
  const regole: Array<[RegExp, string]> = [
    [/^articol\w*\b/, "Articolo di legge"],
    [/^allegat/, "Allegato"],
    [/^(?:dl|decreto[\s-]+legge)\b/, "Decreto-legge"],
    [/^(?:dlgs|d\s?lgs|decreto legislativo)\b/, "Decreto legislativo"],
    [/^(?:dpr|d\s?p\s?r)\b/, "D.P.R."],
    [/^decreto (?:del )?ministr|^(?:dm|d\s?m)\b/, "Decreto ministeriale"],
    [/^decret/, "Decreto"],
    [/^(?:\d{4}[ -]\d{2}[ -]\d{2}[ -])?circolar/, "Circolare"],
    [/^risoluzion/, "Risoluzione"],
    [/^(?:\d{2}[ -]\d{2}[ -]\d{4}[ -])?provv/, "Provvedimento"],
    [/^(?:cs|comunicat)\b/, "Comunicato stampa"],
    [/^(?:legge|l)\s+\d/, "Legge"],
    [/^schema accordo|^accordo/, "Accordo"],
    [/^tabell/, "Tabella"],
    [/^nota\b/, "Nota"],
  ];
  for (const [re, tipo] of regole) if (re.test(t)) return tipo;
  return null;
}

/* -------------------------------------------------------------------------- */
/* Intestazione dell'atto nel testo                                            */
/* -------------------------------------------------------------------------- */

interface Intestazione {
  tipo: string;
  numero: string | null;
  data: string | null;
  posizione: number;
}

const NUM = `(?:\\s*,?\\s*n\\.?\\s*°?\\s*(\\d+(?:\\s*\\/\\s*[A-Za-z0-9]+)?))?`;
const INTESTAZIONI: Array<[RegExp, string]> = [
  [new RegExp(`\\bdecreto[\\s-]+legge\\s+(${DATA})${NUM}`, "i"), "Decreto-legge"],
  [new RegExp(`\\bdecreto\\s+legislativo\\s+(${DATA})${NUM}`, "i"), "Decreto legislativo"],
  [new RegExp(`\\bdecreto\\s+del\\s+presidente\\s+della\\s+repubblica\\s+(${DATA})${NUM}`, "i"), "D.P.R."],
  [new RegExp(`\\bregio\\s+decreto(?:[\\s-]+legge)?\\s+(${DATA})${NUM}`, "i"), "Regio decreto"],
  [new RegExp(`\\bministero\\b[^.]{0,140}?\\bdecreto\\s+(${DATA})${NUM}`, "i"), "Decreto ministeriale"],
  [new RegExp(`\\bdecreto\\s+(?:ministeriale\\s+)?(${DATA})${NUM}`, "i"), "Decreto"],
  [new RegExp(`\\blegge\\s+(${DATA})${NUM}`, "i"), "Legge"],
  [/\bcircolare\s+n\.?\s*°?\s*(\d+(?:\s*\/\s*[A-Za-z0-9]+)?)/i, "Circolare"],
  [/\brisoluzione\s+n\.?\s*°?\s*(\d+(?:\s*\/\s*[A-Za-z0-9]+)?)/i, "Risoluzione"],
  [new RegExp(`\\bprovvedimento\\b[^.]{0,60}?(?:prot\\.?\\s*)?(?:n\\.?\\s*°?\\s*([\\d/]+)\\s+)?(?:del\\s+)?(${DATA})`, "i"), "Provvedimento"],
  [/\bnota\s+(?:prot\.?\s*)?n\.?\s*°?\s*(\d[\d/.-]*)/i, "Nota"],
];

/** L'intestazione piu' in alto nelle prime righe (null se non c'e'). */
export function intestazione(testo: string): Intestazione | null {
  const testa = testo.slice(0, 600).replace(/\s+/g, " ");
  let migliore: Intestazione | null = null;
  for (const [re, tipo] of INTESTAZIONI) {
    const m = re.exec(testa);
    if (!m || (migliore && m.index >= migliore.posizione)) continue;
    let numero: string | null = null;
    let data: string | null = null;
    if (tipo === "Circolare" || tipo === "Risoluzione" || tipo === "Nota") numero = m[1];
    else if (tipo === "Provvedimento") {
      numero = m[1] ?? null;
      data = dataIso(m[2]);
    } else {
      data = dataIso(m[1]);
      numero = m[2] ?? null;
    }
    migliore = { tipo, numero: numero ? numero.replace(/\s+/g, "").toUpperCase().replace(/^0+(?=\d)/, "") : null, data, posizione: m.index };
  }
  if (migliore && !migliore.data) {
    // Data di emanazione: "del 18 novembre 2011" vicino all'intestazione o "Roma, 18 novembre 2011".
    const zona = testo.slice(0, 1200).replace(/\s+/g, " ");
    const del = zona.slice(migliore.posizione, migliore.posizione + 220).match(new RegExp(`\\bdel\\s+(${DATA})`, "i"));
    migliore.data = dataIso(del?.[1] ?? "") ?? dataRoma(testo);
  }
  return migliore;
}

/** "Roma, 18 novembre 2011" (luogo e data di firma) nelle prime righe. */
export function dataRoma(testo: string): string | null {
  const zona = testo.slice(0, 1200).replace(/\s+/g, " ");
  const m = zona.match(new RegExp(`\\broma,?\\s+(?:l[iì]\\s+)?(${DATA})`, "i"));
  return m ? dataIso(m[1]) : null;
}

/** Cartelle di prassi dell'Agenzia: la data di firma e' quella dell'atto. */
const PRASSI = /circolar|risoluzion|provvediment|^note$|nota|chiariment|direttiv|istruzion|determinazion|procedur|comunicat|sito ade/;

/** 1917/2017, 2107/2017: stesse cifre o stesso finale con secolo diverso. */
const refuso = (a: number, b: number) => a !== b && (a % 100 === b % 100 || [...String(a)].sort().join("") === [...String(b)].sort().join(""));

/* -------------------------------------------------------------------------- */
/* Titoli inservibili                                                          */
/* -------------------------------------------------------------------------- */

const RE_TITOLO_INSERVIBILE =
  /non (?:e|è|e')\s+possibile|non c'?\s*(?:e|è)\s+testo|testo fornito|mi dispiace|non riesco|impossibile estrarre|nessun (?:testo|contenuto)|^(?:corso|mod\.?|nota|guida|slide|documento|allegato)$/i;

export const titoloInservibile = (t: string) => RE_TITOLO_INSERVIBILE.test(t.trim()) || t.trim().length < 4;

const tagliaParole = (s: string, max: number) => {
  if (s.length <= max) return s;
  const corto = s.slice(0, max);
  return corto.slice(0, Math.max(corto.lastIndexOf(" "), 20)).replace(/[\s,;:–-]+$/, "");
};

function titoloDiRipiego(d: DocMeta, schema: SchemaNome | null): string | null {
  const oggetto = d.testo.slice(0, 1500).replace(/\s+/g, " ").match(/\boggetto\s*:\s*(.{12,200}?)(?=\s+(?:destinatari|premessa|allegat|data decorrenza|ente emittente|\d\.\s)|\.\s|$)/i);
  const candidati = [oggetto?.[1], schema?.oggetto, d.nomeFile.replace(/\.(?:pdf|doc)\b.*$/i, "").split(" - ").pop()];
  for (const c of candidati) {
    const pulito = (c ?? "")
      .replace(/\.(?:pdf|docx?|odt|rtf)\b.*$/i, "")
      .replace(/[_]+/g, " ")
      .replace(/^mod\b\.?\s+/i, "Modulo ")
      .replace(/\s+/g, " ")
      .replace(/^[\s"'«“]+|[\s"'»”.]+$/g, "")
      .trim();
    if (pulito.split(" ").length >= 3 && !titoloInservibile(pulito)) {
      const t = tagliaParole(pulito, 95);
      return t.charAt(0).toUpperCase() + t.slice(1);
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Normalizzazione                                                             */
/* -------------------------------------------------------------------------- */

const RE_ANNO = /(?<!\d)(18[5-9]\d|19\d\d|20[0-4]\d)(?!\d)/g;

/** "72011" con anno 2011 -> "7/2011": nei nomi curati numero e anno si fondono. */
function numeroDaSchema(numero: string | null, anno: number): string | null {
  if (!numero) return null;
  const m = numero.match(/^(\d{1,3})(\d{4})$/);
  if (m && Number(m[2]) === anno) return `${Number(m[1])}/${m[2]}`;
  return numero;
}

function estremi(tipo: string, numero: string | null, data: string | null): string | null {
  if (!numero && !data) return null;
  return `${tipo}${numero ? ` n. ${numero}` : ""}${data ? ` del ${dataLeggibile(data)}` : ""}`;
}

export function normalizzaMetadati(d: DocMeta): Proposta {
  const revisione: string[] = [];
  const schema = schemaNome(d.nomeFile);
  const cartellaNorm = norm(d.cartella.replace(/^\s*\d+\s*-\s*/, ""));
  const divulgativa = DIVULGATIVE.test(cartellaNorm);
  const testa = intestazione(d.testo);

  // 1) Tipologia.
  const daNome = schema ? tipoDaAbbreviazione(schema.abbreviazione) : null;
  const daTitolo = tipoDaTitoloLibero(d.titolo) ?? (schema ? null : tipoDaTitoloLibero(d.nomeFile));
  const daCartella = tipoDaCartella(d.cartella);
  let tipoAtto = daNome ?? daTitolo ?? daCartella;
  let origineTipo: Proposta["origineTipo"] = daNome || daTitolo ? "titolo" : "cartella";
  const testaAffidabile = !!testa && testa.posizione < 320 && !!(testa.numero || testa.data);
  if (testaAffidabile && testa) {
    const generico = ["Decreto", "Documento", "Allegato"].includes(tipoAtto) || TIPO_STUDIO[tipoAtto] === TIPO_STUDIO[testa.tipo];
    if (!divulgativa && (generico || /sito ade/.test(cartellaNorm))) {
      tipoAtto = testa.tipo === "Decreto" && TIPO_STUDIO[tipoAtto] === "Decreto" && tipoAtto !== "Decreto" ? tipoAtto : testa.tipo;
      origineTipo = "testo";
    } else if (TIPO_STUDIO[tipoAtto] !== TIPO_STUDIO[testa.tipo]) {
      revisione.push(`il testo si apre come ${testa.tipo}${testa.numero ? ` n. ${testa.numero}` : ""}, ma la scheda indica ${tipoAtto}`);
    }
  }

  // 2) Numero e data.
  const concorde = !!testa && TIPO_STUDIO[testa.tipo] === TIPO_STUDIO[tipoAtto];
  let numero = concorde && testa?.numero ? testa.numero : numeroDaSchema(schema?.numero ?? null, d.anno || schema?.anno || 0);
  const firma = !divulgativa && PRASSI.test(cartellaNorm) ? dataRoma(d.testo) : null;
  const data = concorde && testa?.data ? testa.data : firma;
  // "Decr. 27" con "DECRETO 27 maggio 2015": il numero del nome e' il giorno.
  if (numero && data && !testa?.numero && Number(numero) === Number(data.slice(8, 10))) numero = null;

  // 3) Anno.
  let anno: Proposta["anno"] = null;
  const annoData = data ? Number(data.slice(0, 4)) : null;
  const derivata = OPERE_DERIVATE.test(d.titolo) || OPERE_DERIVATE.test(schema?.oggetto ?? "") || divulgativa;
  if (!d.anno) {
    if (annoData && testaAffidabile) anno = { valore: annoData, confidenza: "alta", motivo: `intestazione: ${dataLeggibile(data!)}` };
    else if (annoData && data === firma) anno = { valore: annoData, confidenza: "media", motivo: `data di firma «Roma, ${dataLeggibile(data!)}»` };
    else if (schema?.anno) anno = { valore: schema.anno, confidenza: "media", motivo: "anno nel nome del file" };
    else {
      const nelTitolo = [...`${d.titolo} ${d.nomeFile}`.matchAll(RE_ANNO)].map((m) => Number(m[1])).filter((a) => a <= annoMax());
      if (nelTitolo.length === 1 || (nelTitolo.length > 1 && nelTitolo.every((a) => a === nelTitolo[0]))) {
        anno = { valore: nelTitolo[0], confidenza: "media", motivo: "anno nel titolo" };
      } else if (annoData) {
        revisione.push(`anno mancante: il testo riporta la data ${dataLeggibile(data!)}`);
      }
    }
  } else if (annoData && annoData !== d.anno) {
    const citati = [...d.testo.matchAll(RE_ANNO)].map((m) => Number(m[1])).filter((a) => a <= annoMax());
    const coerente = citati.every((a) => a <= annoData + 1);
    if (testaAffidabile && concorde && !derivata) {
      anno = { valore: annoData, confidenza: "alta", motivo: `intestazione: ${tipoAtto}${numero ? ` n. ${numero}` : ""} del ${dataLeggibile(data!)}` };
    } else if (!testaAffidabile && data === firma && refuso(d.anno, annoData) && coerente && !derivata) {
      anno = { valore: annoData, confidenza: "media", motivo: `refuso dell'anno: firmato «Roma, ${dataLeggibile(data!)}»` };
    } else {
      revisione.push(`anno ${d.anno} registrato, ma il testo è datato ${dataLeggibile(data!)}`);
    }
  }
  if (!anno && d.anno) {
    const citati = [...d.testo.matchAll(RE_ANNO)].map((m) => Number(m[1])).filter((a) => a <= annoMax());
    const max = citati.length ? Math.max(...citati) : 0;
    if (max > d.anno + 3 && !derivata) revisione.push(`anno ${d.anno} registrato, ma il testo cita il ${max}`);
  }

  // 4) Titolo inservibile.
  let titolo: Proposta["titolo"] = null;
  if (titoloInservibile(d.titolo)) {
    const nuovo = titoloDiRipiego(d, schema);
    if (nuovo && nuovo !== d.titolo) titolo = { valore: nuovo, motivo: `titolo inservibile («${d.titolo.slice(0, 60)}»)` };
    else revisione.push(`titolo inservibile («${d.titolo.slice(0, 60)}») senza un'alternativa affidabile`);
  }

  return { tipoAtto, origineTipo, numero, data, estremi: estremi(tipoAtto, numero, data), anno, titolo, revisione };
}
