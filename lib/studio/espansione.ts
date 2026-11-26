/**
 * Espansione dell'argomento di studio in un insieme di concetti cercabili.
 *
 * Tre strati deterministici (spiegabili, istantanei, gratuiti):
 *  1. morfologia: radici italiane leggere ("volture" -> voltur*, che copre
 *     voltura, volture, volturazione) e varianti singolare/plurale per le
 *     parole corte ("tipi" -> tipo, tipi);
 *  2. codici di categoria: "F/3", "f3", "categoria D/10" -> frase "f 3"
 *     (il tokenizer separa la barra) + descrizione ufficiale della categoria;
 *  3. tesauro catastale curato: sinonimi tecnici e diciture correlate
 *     (voltura -> mutazione soggettiva, Voltura 2.0, intestazioni...).
 * Un quarto strato (modello linguistico) e' in lib/studio/pipeline.ts e viene
 * accettato solo se le sue espressioni esistono davvero nel corpus.
 *
 * Ogni concetto produce un'espressione FTS5 (per il recupero) e una regex
 * gemella (per evidenziare ed estrarre i passaggi dal testo originale, con
 * accenti e maiuscole).
 */

import type { OrigineConcetto } from "./tipi";

export interface Concetto {
  etichetta: string;
  fts: string;
  /** Sorgente regex da usare con flag "giu" sul testo originale. */
  regex: string;
  peso: number;
  origine: OrigineConcetto;
  /** Codice di categoria (es. "f/3"): richiede verifica della barra nel testo. */
  codice?: string;
}

/* -------------------------------------------------------------------------- */
/* Normalizzazione e morfologia                                               */
/* -------------------------------------------------------------------------- */

export function normalizza(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[‘’ʼ´`]/g, "'");
}

/** Token alfanumerici (stesso criterio del tokenizer unicode61 dell'indice). */
export function tokens(s: string): string[] {
  return normalizza(s).split(/[^a-z0-9]+/).filter(Boolean);
}

const STOP = new Set(
  ("a ad al allo ai agli all alla alle con col coi da dal dallo dai dagli dall dalla dalle di del dello dei degli dell della delle " +
    "e ed il lo la i gli le l un uno una in nel nello nei negli nell nella nelle per su sul sullo sui sugli sull sulla sulle tra fra " +
    "o od che cui come non piu sono essere ai sensi art articolo n nr ecc etc").split(" ")
);

/** Parole significative di una frase: niente articoli, preposizioni, parole di 1-2 lettere. */
export function paroleSignificative(s: string, altreStop?: Set<string>): string[] {
  return tokens(s).filter((t) => !STOP.has(t) && !altreStop?.has(t) && (t.length >= 3 || /\d/.test(t)));
}

/**
 * Radice leggera per la ricerca a prefisso: toglie la vocale finale (e le
 * desinenze -che/-chi/-ghe/-ghi, -zione/-zioni), mai sotto 4 caratteri.
 * Volutamente conservativa: meglio un prefisso un po' largo dentro un NEAR che
 * perdere una forma flessa.
 */
export function radice(t: string): string {
  if (t.length <= 4 || /\d/.test(t)) return t;
  if (/(?:ch|gh)[eio]$/.test(t) && t.length > 6) return t.slice(0, -2);
  if (/zion[ei]$/.test(t)) return t.slice(0, -1);
  if (/[aeio]$/.test(t)) return t.slice(0, -1);
  return t;
}

/** Varianti singolare/plurale per le parole corte (niente prefisso: troppo largo). */
function varianti(t: string): string[] {
  if (t.length > 4 || /\d/.test(t)) return [t];
  const base = t.slice(0, -1);
  if (t.endsWith("o")) return [t, `${base}i`];
  if (t.endsWith("a")) return [t, `${base}e`];
  if (t.endsWith("e")) return [t, `${base}i`];
  if (t.endsWith("i")) return [t, `${base}o`, `${base}e`];
  return [t];
}

/* -------------------------------------------------------------------------- */
/* Costruttori FTS + regex                                                    */
/* -------------------------------------------------------------------------- */

const VOC: Record<string, string> = { a: "[aàáâ]", e: "[eèéê]", i: "[iìíî]", o: "[oòóô]", u: "[uùúû]" };
const LET = "[\\p{L}\\p{N}]";
const SEP = "[\\s\\p{P}]+";

function rxToken(t: string, prefisso: boolean): string {
  const corpo = t.replace(/[aeiou]/g, (v) => VOC[v]);
  return `(?<!${LET})${corpo}${prefisso ? `${LET}*` : `(?!${LET})`}`;
}

/** Parola singola a prefisso: "voltur*". */
export function termine(parola: string): { fts: string; regex: string } {
  const t = tokens(parola)[0] ?? "";
  if (!t) return { fts: "", regex: "" };
  if (t.length <= 4 && !/\d/.test(t)) {
    const v = varianti(t);
    return { fts: v.length > 1 ? `(${v.join(" OR ")})` : v[0], regex: `(?:${v.map((x) => rxToken(x, false)).join("|")})` };
  }
  const r = radice(t);
  return { fts: `${r}*`, regex: rxToken(r, true) };
}

/** Frase esatta con l'ultima parola a prefisso: "in corso di costruzion"*. */
export function frase(testo: string, prefissoFinale = true): { fts: string; regex: string } {
  const tk = tokens(testo);
  if (!tk.length) return { fts: "", regex: "" };
  const ultimo = tk[tk.length - 1];
  const usaPrefisso = prefissoFinale && ultimo.length > 4 && !/\d/.test(ultimo);
  const corpo = [...tk.slice(0, -1), usaPrefisso ? radice(ultimo) : ultimo];
  const fts = `"${corpo.join(" ")}"${usaPrefisso ? "*" : ""}`;
  const regex = corpo.map((t, i) => rxToken(t, i === corpo.length - 1 && usaPrefisso)).join(SEP);
  return { fts, regex };
}

/** Parole vicine in qualunque ordine: NEAR(fabbricat* rural*, 3). */
export function vicine(testo: string, distanza: number): { fts: string; regex: string } {
  const tk = tokens(testo).filter((t) => !STOP.has(t));
  if (tk.length === 0) return { fts: "", regex: "" };
  if (tk.length === 1) return termine(tk[0]);
  // Le parole corte hanno varianti esatte: si espandono le combinazioni.
  const opzioni = tk.map((t) => (t.length <= 4 && !/\d/.test(t) ? varianti(t) : [`${radice(t)}*`]));
  let combinazioni: string[][] = [[]];
  for (const o of opzioni) combinazioni = combinazioni.flatMap((c) => o.map((x) => [...c, x])).slice(0, 12);
  const fts = combinazioni.map((c) => `NEAR(${c.join(" ")}, ${distanza})`).join(" OR ");
  const pezzi = tk.map((t) => (t.length <= 4 && !/\d/.test(t) ? `(?:${varianti(t).map((x) => rxToken(x, false)).join("|")})` : rxToken(radice(t), true)));
  const gap = `(?:${SEP}${LET}+){0,${distanza}}?${SEP}`;
  const regex =
    pezzi.length === 2 ? `(?:${pezzi[0]}${gap}${pezzi[1]}|${pezzi[1]}${gap}${pezzi[0]})` : pezzi.join(`${gap}`);
  return { fts: combinazioni.length > 1 ? `(${fts})` : fts, regex };
}

/** Codice di categoria catastale: "f/3" -> frase "f 3" + regex con la barra. */
export function codice(lettera: string, numero: string): { fts: string; regex: string } {
  const l = lettera.toLowerCase();
  return { fts: `"${l} ${Number(numero)}"`, regex: `(?<!${LET})${l}\\s*\\/\\s*0?${Number(numero)}(?![\\p{N}])` };
}

/* -------------------------------------------------------------------------- */
/* Categorie catastali                                                         */
/* -------------------------------------------------------------------------- */

const CATEGORIE: Record<string, string> = {
  "a/1": "abitazioni di tipo signorile", "a/2": "abitazioni di tipo civile", "a/3": "abitazioni di tipo economico",
  "a/4": "abitazioni di tipo popolare", "a/5": "abitazioni di tipo ultrapopolare", "a/6": "abitazioni di tipo rurale",
  "a/7": "abitazioni in villini", "a/8": "abitazioni in ville", "a/9": "castelli palazzi di eminenti pregi",
  "a/10": "uffici e studi privati", "a/11": "abitazioni tipici dei luoghi",
  "b/1": "collegi convitti", "b/2": "case di cura ed ospedali", "b/3": "prigioni e riformatori", "b/4": "uffici pubblici",
  "b/5": "scuole e laboratori scientifici", "b/6": "biblioteche pinacoteche musei", "b/7": "cappelle ed oratori",
  "b/8": "magazzini sotterranei",
  "c/1": "negozi e botteghe", "c/2": "magazzini e locali di deposito", "c/3": "laboratori per arti e mestieri",
  "c/4": "fabbricati e locali per esercizi sportivi", "c/5": "stabilimenti balneari", "c/6": "stalle scuderie rimesse autorimesse",
  "c/7": "tettoie chiuse od aperte",
  "d/1": "opifici", "d/2": "alberghi e pensioni", "d/3": "teatri cinematografi", "d/4": "case di cura ed ospedali",
  "d/5": "istituto di credito cambio e assicurazione", "d/6": "fabbricati per esercizi sportivi", "d/7": "esigenze di un'attività industriale",
  "d/8": "esigenze di un'attività commerciale", "d/9": "edifici galleggianti", "d/10": "funzioni produttive connesse alle attività agricole",
  "e/1": "stazioni per servizi di trasporto", "e/2": "ponti comunali e provinciali", "e/3": "costruzioni e fabbricati per speciali esigenze pubbliche",
  "e/4": "recinti chiusi per speciali esigenze pubbliche", "e/5": "fabbricati costituenti fortificazioni", "e/6": "fari semafori torri",
  "e/7": "fabbricati destinati all'esercizio pubblico dei culti", "e/8": "fabbricati e costruzioni nei cimiteri", "e/9": "edifici a destinazione particolare",
  "f/1": "area urbana", "f/2": "unità collabenti", "f/3": "in corso di costruzione", "f/4": "in corso di definizione",
  "f/5": "lastrico solare", "f/6": "in attesa di dichiarazione", "f/7": "infrastrutture di reti pubbliche di comunicazione",
};

/* -------------------------------------------------------------------------- */
/* Tesauro catastale                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Spec compatte: "t:" termine a prefisso · "p:" frase (ultima parola a
 * prefisso) · "x:" frase esatta · "nK:" parole vicine entro K · "c:" codice.
 * Peso 1 = nucleo dell'istituto; 0.5-0.8 = correlato (pesa meno nel punteggio).
 */
type Voce = [etichetta: string, spec: string, peso: number];

const TESAURO: Array<{ quando: RegExp; concetti: Voce[] }> = [
  { quando: /\bvoltur|\bmutazion\w* soggettiv|\bintestazion/, concetti: [
    ["voltura", "t:voltura", 1], ["domanda di voltura", "p:domanda di voltura", 1], ["voltura catastale", "n2:voltura catastale", 1],
    ["Voltura 2.0", "x:voltura 2 0", 1], ["mutazione soggettiva", "n2:mutazione soggettiva", 0.9],
    ["aggiornamento delle intestazioni", "n4:aggiornamento intestazioni", 0.8], ["intestazione catastale", "n2:intestazione catastale", 0.8],
    ["riunione di usufrutto", "n3:riunione usufrutto", 0.6], ["modello unico informatico", "p:modello unico informatico", 0.6],
    ["volture e successioni", "n10:voltura successione", 0.6], ["trascrizione e voltura", "n8:trascrizione voltura", 0.5],
  ]},
  { quando: /\bsuccession/, concetti: [
    ["dichiarazione di successione", "n3:dichiarazione successione", 1], ["voltura automatica", "n3:voltura automatica", 0.8],
    ["riunione di usufrutto", "n3:riunione usufrutto", 0.6], ["imposta di successione", "n2:imposta successione", 0.7],
  ]},
  { quando: /\bfabbricat\w* rural|\bruralit|\brural/, concetti: [
    ["fabbricati rurali", "n3:fabbricati rurali", 1], ["ruralità", "t:ruralita", 1], ["requisiti di ruralità", "n3:requisiti ruralita", 1],
    ["annotazione di ruralità", "n4:annotazione ruralita", 0.9], ["costruzioni rurali", "n2:costruzioni rurali", 0.8],
    ["strumentali all'attività agricola", "n4:strumentali agricola", 0.9], ["categoria D/10", "c:d/10", 0.9], ["categoria A/6", "c:a/6", 0.6],
    ["art. 9 D.L. 557/1993", "x:557 1993", 0.9], ["fabbricati rurali nel catasto urbano", "n8:rurali catasto urbano", 0.8],
    ["D.L. 201/2011", "x:201 2011", 0.6],
  ]},
  { quando: /\bf ?\/? ?3\b|\bcorso di costruzion/, concetti: [
    ["F/3", "c:f/3", 1], ["in corso di costruzione", "p:in corso di costruzione", 1], ["fabbricato in corso di costruzione", "p:fabbricato in corso di costruzione", 1],
    ["unità in corso di costruzione", "n4:unita corso costruzione", 0.9], ["categorie fittizie", "n2:categorie fittizie", 0.6],
    ["F/4 in corso di definizione", "p:in corso di definizione", 0.5],
  ]},
  { quando: /\bf ?\/? ?4\b|\bcorso di definizion/, concetti: [
    ["F/4", "c:f/4", 1], ["in corso di definizione", "p:in corso di definizione", 1], ["categorie fittizie", "n2:categorie fittizie", 0.6],
  ]},
  { quando: /\bf ?\/? ?2\b|\bcollabent|\bdirut|\brudere/, concetti: [
    ["F/2", "c:f/2", 1], ["unità collabenti", "t:collabenti", 1], ["fabbricati diruti", "n2:fabbricati diruti", 0.8], ["ruderi", "t:ruderi", 0.6],
    ["categorie fittizie", "n2:categorie fittizie", 0.6],
  ]},
  { quando: /\bf ?\/? ?1\b|\barea urban|\baree urban/, concetti: [
    ["F/1", "c:f/1", 1], ["area urbana", "p:area urbana", 1], ["aree urbane", "p:aree urbane", 1],
  ]},
  { quando: /\bf ?\/? ?5\b|\blastric/, concetti: [["F/5", "c:f/5", 1], ["lastrico solare", "n2:lastrico solare", 1]] },
  { quando: /\bf ?\/? ?6\b|\battesa di dichiarazion/, concetti: [["F/6", "c:f/6", 1], ["in attesa di dichiarazione", "p:in attesa di dichiarazione", 1]] },
  { quando: /\btip\w* mappal|\bpregeo|\binseriment\w* in mappa/, concetti: [
    ["tipo mappale", "n2:tipo mappale", 1], ["Pregeo", "t:pregeo", 0.9], ["inserimento in mappa", "n3:inserimento mappa", 0.9],
    ["atti di aggiornamento geometrico", "n3:aggiornamento geometrico", 0.8], ["tipo di frazionamento", "n2:tipo frazionamento", 0.6],
    ["estratto di mappa", "n2:estratto mappa", 0.6], ["punti fiduciali", "n2:punti fiduciali", 0.5], ["libretto delle misure", "n3:libretto misure", 0.5],
  ]},
  { quando: /\bfrazionament/, concetti: [
    ["frazionamento", "t:frazionamento", 1], ["tipo di frazionamento", "n2:tipo frazionamento", 1], ["Pregeo", "t:pregeo", 0.7],
  ]},
  { quando: /\bfotovolta|\bpannell\w* solar|\bimpiant\w* (?:di produzione|energ)|\brinnovabil|\beolic/, concetti: [
    ["fotovoltaico", "t:fotovoltaico", 1], ["impianti fotovoltaici", "n4:impianti fotovoltaici", 1], ["pannelli solari", "n2:pannelli solari", 0.9],
    ["impianti di produzione di energia", "n6:impianti produzione energia", 0.9], ["centrali elettriche", "n2:centrali elettriche", 0.8],
    ["energia da fonti rinnovabili", "n3:energia rinnovabili", 0.7], ["impianti eolici", "t:eolici", 0.6], ["categoria D/1", "c:d/1", 0.6],
    ["imbullonati", "t:imbullonati", 0.5],
  ]},
  { quando: /\bimbullonat|\bimpiant\w* fiss|\bstabilita 2016|\b208 ?\/? ?2015/, concetti: [
    ["imbullonati", "t:imbullonati", 1], ["legge di stabilità 2016", "x:stabilita 2016", 0.9], ["L. 208/2015", "x:208 2015", 0.9],
    ["componenti impiantistiche", "n3:componenti impiantistiche", 0.8], ["stima diretta", "p:stima diretta", 0.7], ["macchinari e congegni", "n5:macchinari congegni", 0.7],
  ]},
  { quando: /\bdocfa|\bdichiarazion\w* di (?:variazion|nuova costruzion)|\baccatastament/, concetti: [
    ["Docfa", "t:docfa", 1], ["dichiarazione di variazione", "n3:dichiarazione variazione", 0.9], ["dichiarazione di nuova costruzione", "p:dichiarazione di nuova costruzione", 0.9],
    ["accatastamento", "t:accatastamento", 0.8], ["rendita proposta", "n2:rendita proposta", 0.7], ["planimetria", "t:planimetria", 0.5],
  ]},
  { quando: /\bbcnc|\bbeni comuni|\bparti comuni|\bcondomin/, concetti: [
    ["beni comuni non censibili", "p:beni comuni non censibili", 1], ["BCNC", "t:bcnc", 1], ["beni comuni censibili", "p:beni comuni censibili", 0.9],
    ["parti comuni", "n2:parti comuni", 0.8], ["elaborato planimetrico", "n2:elaborato planimetrico", 0.7], ["elenco dei subalterni", "n3:elenco subalterni", 0.7],
    ["condominio", "t:condominio", 0.5],
  ]},
  { quando: /\brendit/, concetti: [
    ["rendita catastale", "n2:rendita catastale", 1], ["rendita presunta", "n2:rendita presunta", 0.8], ["rendita proposta", "n2:rendita proposta", 0.8],
    ["tariffe d'estimo", "n3:tariffe estimo", 0.8], ["classamento", "t:classamento", 0.7], ["rettifica della rendita", "n3:rettifica rendita", 0.7],
  ]},
  { quando: /\bclassament|\bmicrozon|\bcomma 33[56]/, concetti: [
    ["classamento", "t:classamento", 1], ["revisione del classamento", "n3:revisione classamento", 1], ["microzone", "t:microzone", 0.9],
    ["comma 335", "x:comma 335", 0.8], ["comma 336", "x:comma 336", 0.8], ["categoria e classe", "n3:categoria classe", 0.6],
  ]},
  { quando: /\bsuperfic\w* catastal|\bdpr 138|\b138 ?\/? ?1998/, concetti: [
    ["superficie catastale", "n2:superficie catastale", 1], ["D.P.R. 138/1998", "x:138 1998", 0.9], ["allegato C", "x:allegato c", 0.6],
    ["metri quadrati", "n1:metri quadrati", 0.5],
  ]},
  { quando: /\bstima dirett|\bdestinazion\w* special|\bcategori\w* d\b|\bimmobil\w* (?:special|di categoria d)/, concetti: [
    ["stima diretta", "p:stima diretta", 1], ["immobili a destinazione speciale", "n3:destinazione speciale", 1],
    ["categoria D", "x:categoria d", 0.8], ["saggio di redditività", "n2:saggio redditivita", 0.7], ["costo di ricostruzione", "n2:costo ricostruzione", 0.6],
  ]},
  { quando: /\bplanimetri/, concetti: [
    ["planimetria", "t:planimetria", 1], ["elaborato planimetrico", "n2:elaborato planimetrico", 0.8], ["consultazione delle planimetrie", "n3:consultazione planimetrie", 0.7],
  ]},
  { quando: /\bconformit|\ballineament/, concetti: [
    ["conformità catastale", "n2:conformita catastale", 1], ["dichiarazione di conformità", "n3:dichiarazione conformita", 0.9],
    ["D.L. 78/2010", "x:78 2010", 0.8], ["allineamento delle intestazioni", "n5:allineamento intestazioni", 0.7], ["atti notarili", "n3:atti notarili", 0.6],
  ]},
  { quando: /\bfantasm|\bnon dichiarat|\bfotoidentific/, concetti: [
    ["immobili non dichiarati", "n3:immobili dichiarati", 1], ["immobili fantasma", "n2:immobili fantasma", 1], ["fotoidentificazione", "t:fotoidentificazione", 0.9],
    ["rendita presunta", "n2:rendita presunta", 0.8],
  ]},
  { quando: /\bpubblicit\w* immobiliar|\btrascrizion|\bconservatori|\bregistri immobiliar|\bipotec/, concetti: [
    ["pubblicità immobiliare", "n2:pubblicita immobiliare", 1], ["trascrizione", "t:trascrizione", 0.9], ["registri immobiliari", "n2:registri immobiliari", 0.9],
    ["conservatoria", "t:conservatoria", 0.8], ["nota di trascrizione", "n2:nota trascrizione", 0.8], ["ispezione ipotecaria", "n2:ispezione ipotecaria", 0.7],
    ["iscrizione ipotecaria", "n2:iscrizione ipotecaria", 0.7],
  ]},
  { quando: /\bimpost\w* (?:ipotecar|catastal)|\btribut\w* special|\btass\w* ipotecar|\bf23\b/, concetti: [
    ["imposta ipotecaria", "n3:imposta ipotecaria", 1], ["imposta catastale", "n2:imposta catastale", 1], ["tributi speciali catastali", "n2:tributi speciali", 0.9],
    ["tasse ipotecarie", "n2:tasse ipotecarie", 0.8], ["modello F23", "x:f23", 0.5],
  ]},
  { quando: /\bcatasto (?:dei )?terren|\bqualit\w* di coltur|\breddit\w* (?:dominical|agrari)|\bvariazion\w* coltural/, concetti: [
    ["catasto terreni", "n2:catasto terreni", 1], ["qualità di coltura", "n2:qualita coltura", 0.9], ["reddito dominicale", "n2:reddito dominicale", 0.9],
    ["reddito agrario", "n2:reddito agrario", 0.9], ["variazioni colturali", "n2:variazioni colturali", 0.8], ["AGEA", "t:agea", 0.6],
  ]},
  { quando: /\bsubaltern|\bidentificativ/, concetti: [
    ["subalterno", "t:subalterno", 1], ["elaborato planimetrico", "n2:elaborato planimetrico", 0.7], ["identificativo catastale", "n2:identificativo catastale", 0.8],
    ["soppressione e costituzione", "n3:soppressione costituzione", 0.6],
  ]},
  { quando: /\bfusion|\bporzion|\bunit\w* di fatto|\bgraffat/, concetti: [
    ["fusione di unità", "n4:fusione unita", 1], ["porzioni di unità immobiliari", "n4:porzioni unita", 1], ["unite di fatto", "p:unite di fatto", 0.9],
    ["graffatura", "t:graffatura", 0.8],
  ]},
  { quando: /\bdestinazion\w* d.? ?uso|\bcambio d.? ?uso|\bmutament\w* di destinazion/, concetti: [
    ["destinazione d'uso", "n2:destinazione uso", 1], ["mutamento di destinazione", "n2:mutamento destinazione", 0.9], ["cambio d'uso", "x:cambio d uso", 0.9],
  ]},
  { quando: /\bsanzion|\bravvediment|\bomess\w* dichiarazion/, concetti: [
    ["sanzioni catastali", "n2:sanzioni catastali", 1], ["ravvedimento operoso", "n2:ravvedimento operoso", 0.9], ["omessa dichiarazione", "n2:omessa dichiarazione", 0.8],
    ["violazioni", "n3:violazioni catastali", 0.7],
  ]},
  { quando: /\bvisur|\bsister|\bconsultazion|\bcertificazion/, concetti: [
    ["visura catastale", "n2:visura catastale", 1], ["Sister", "t:sister", 0.8], ["consultazione", "n3:consultazione catastale", 0.8], ["certificazioni catastali", "n2:certificazioni catastali", 0.7],
  ]},
  { quando: /\btavolar|\blibro fondiari/, concetti: [
    ["sistema tavolare", "t:tavolare", 1], ["libro fondiario", "n2:libro fondiario", 1], ["province autonome", "n2:province autonome", 0.5],
  ]},
  { quando: /\bomi\b|\bosservatorio|\bquotazion|\bvalor\w* immobiliar/, concetti: [
    ["OMI", "t:omi", 1], ["Osservatorio del mercato immobiliare", "p:osservatorio del mercato immobiliare", 1], ["quotazioni immobiliari", "n2:quotazioni immobiliari", 0.8],
  ]},
  { quando: /\bagibilit|\babitabilit/, concetti: [["agibilità", "t:agibilita", 1], ["abitabilità", "t:abitabilita", 0.9], ["certificato di agibilità", "n2:certificato agibilita", 0.8]] },
  { quando: /\bcartografi|\bmapp\w* catastal|\bwms\b|\bfogli\w* di mappa/, concetti: [
    ["cartografia catastale", "n2:cartografia catastale", 1], ["mappa catastale", "n2:mappa catastale", 1], ["fogli di mappa", "n2:fogli mappa", 0.8],
    ["servizio WMS", "t:wms", 0.6], ["cartografia vettoriale", "n2:cartografia vettoriale", 0.6],
  ]},
  { quando: /\bpunt\w* fiducial|\bret\w* fiducial/, concetti: [["punti fiduciali", "n2:punti fiduciali", 1], ["rete fiduciale", "n2:rete fiduciale", 0.8], ["monografie", "t:monografie", 0.6]] },
  { quando: /\bpertinenz|\bautorimess|\bcantin|\bbox\b/, concetti: [
    ["pertinenze", "t:pertinenze", 1], ["autorimesse", "t:autorimesse", 0.8], ["categoria C/6", "c:c/6", 0.8], ["categoria C/2", "c:c/2", 0.7], ["categoria C/7", "c:c/7", 0.6],
  ]},
  { quando: /\bimu\b|\bici\b|\bimposta municipal/, concetti: [["IMU", "t:imu", 1], ["ICI", "t:ici", 0.7], ["imposta municipale", "n2:imposta municipale", 0.9], ["base imponibile", "n2:base imponibile", 0.6]] },
  { quando: /\busucapion/, concetti: [["usucapione", "t:usucapione", 1], ["sentenza di usucapione", "n3:sentenza usucapione", 0.8]] },
  { quando: /\briform\w* (?:del )?catast|\brevision\w* (?:degli )?estim|\bvalor\w* patrimonial/, concetti: [
    ["riforma del catasto", "n3:riforma catasto", 1], ["revisione degli estimi", "n3:revisione estimi", 1], ["valore patrimoniale", "n2:valore patrimoniale", 0.8],
    ["legge delega 23/2014", "x:23 2014", 0.7],
  ]},
  { quando: /\bent\w* urban/, concetti: [["ente urbano", "n2:ente urbano", 1], ["enti urbani", "n2:enti urbani", 1]] },
  { quando: /\bsism|\bterremot|\bcalamit/, concetti: [["sisma", "t:sisma", 1], ["eventi sismici", "n2:eventi sismici", 0.9], ["calamità", "t:calamita", 0.7], ["inagibilità", "t:inagibilita", 0.6]] },
  { quando: /\bdemani/, concetti: [["demanio", "t:demanio", 1], ["beni demaniali", "n2:beni demaniali", 0.9]] },
];

function compila(spec: string): { fts: string; regex: string } {
  const [tipo, ...resto] = spec.split(":");
  const corpo = resto.join(":");
  if (tipo === "t") return termine(corpo);
  if (tipo === "p") return frase(corpo, true);
  if (tipo === "x") return frase(corpo, false);
  if (tipo === "c") {
    const m = corpo.match(/^([a-f])\/(\d{1,2})$/i);
    return m ? codice(m[1], m[2]) : { fts: "", regex: "" };
  }
  const near = tipo.match(/^n(\d+)$/);
  if (near) return vicine(corpo, Number(near[1]));
  return { fts: "", regex: "" };
}

/* -------------------------------------------------------------------------- */
/* Piano di espansione                                                         */
/* -------------------------------------------------------------------------- */

export interface PianoEspansione {
  chiave: string;
  argomento: string;
  concetti: Concetto[];
}

/** Chiave di cache: radici ordinate ("Volture" e "voltura" -> stesso dossier). */
export function chiaveArgomento(argomento: string): string {
  const norm = normalizza(argomento);
  // I codici di categoria valgono come un unico token ("categoria F/3" = "f3" = "F/3").
  const codici = [...norm.matchAll(/(?<![a-z0-9])([a-f])\s*\/?\s*(\d{1,2})(?![0-9])/g)].map((m) => `${m[1]}/${Number(m[2])}`);
  const resto = norm.replace(/(?<![a-z0-9])(?:categori\w*\s+)?[a-f]\s*\/?\s*\d{1,2}(?![0-9])/g, " ");
  const r = tokens(resto)
    .filter((t) => !STOP.has(t))
    .map((t) => (t.length > 4 && !/\d/.test(t) ? radice(t) : t));
  return [...new Set([...codici, ...r])].sort().join(" ").slice(0, 120);
}

export function espandiArgomento(argomentoGrezzo: string): PianoEspansione {
  const argomento = argomentoGrezzo.replace(/\s+/g, " ").trim().slice(0, 120);
  const norm = normalizza(argomento);
  const concetti: Concetto[] = [];
  const visti = new Set<string>();
  const aggiungi = (c: Concetto) => {
    if (!c.fts || !c.regex || visti.has(c.fts)) return;
    visti.add(c.fts);
    concetti.push(c);
  };

  // 1) Codici di categoria nell'argomento ("F/3", "f3", "categoria D 10").
  const codiciTrovati = [...norm.matchAll(/(?<![a-z0-9])([a-f])\s*\/?\s*(\d{1,2})(?![0-9])/g)];
  for (const m of codiciTrovati) {
    const cod = `${m[1]}/${Number(m[2])}`;
    if (!CATEGORIE[cod]) continue;
    aggiungi({ etichetta: cod.toUpperCase(), ...codice(m[1], m[2]), peso: 1, origine: "argomento", codice: cod });
    aggiungi({ etichetta: `${cod.toUpperCase()} — ${CATEGORIE[cod]}`, ...frase(CATEGORIE[cod], true), peso: 0.9, origine: "tesauro" });
  }

  // 2) L'argomento cosi' com'e' (senza i codici gia' trattati).
  const testoSenzaCodici = norm.replace(/(?<![a-z0-9])(?:categori\w*\s+)?[a-f]\s*\/?\s*\d{1,2}(?![0-9])/g, " ");
  const significative = tokens(testoSenzaCodici).filter((t) => !STOP.has(t));
  if (significative.length === 1) {
    const t = significative[0];
    aggiungi({ etichetta: argomento, ...termine(t), peso: 1, origine: "argomento" });
  } else if (significative.length > 1) {
    const distanza = Math.min(10, Math.max(3, significative.length * 2));
    aggiungi({ etichetta: argomento, ...vicine(significative.join(" "), distanza), peso: 1, origine: "argomento" });
    // La frase esatta pesa come il nucleo: e' la dicitura dell'utente.
    if (significative.length <= 5) aggiungi({ etichetta: `“${argomento}”`, ...frase(testoSenzaCodici, true), peso: 1, origine: "morfologia" });
  }

  // 3) Tesauro: tutte le voci il cui innesco compare nell'argomento.
  for (const voce of TESAURO) {
    if (!voce.quando.test(norm)) continue;
    for (const [etichetta, spec, peso] of voce.concetti) {
      const c = compila(spec);
      const cod = spec.startsWith("c:") ? spec.slice(2).toLowerCase() : undefined;
      aggiungi({ etichetta, ...c, peso, origine: "tesauro", ...(cod ? { codice: cod } : {}) });
    }
  }

  return { chiave: chiaveArgomento(argomento), argomento, concetti: concetti.slice(0, 24) };
}

/** Concetti aggiuntivi proposti dal modello: ognuno diventa una frase o un NEAR. */
export function concettoDaTermine(termineAi: string): Concetto | null {
  const pulito = termineAi.replace(/["«»“”]/g, "").trim();
  const tk = tokens(pulito).filter((t) => !STOP.has(t));
  if (!tk.length || tk.length > 5 || pulito.length > 60) return null;
  const c = tk.length === 1 ? termine(tk[0]) : frase(pulito, true);
  if (!c.fts) return null;
  return { etichetta: pulito, ...c, peso: 0.6, origine: "ai" };
}

/** Unione OR di tutte le espressioni (per snippet e conteggi). */
export function unioneFts(concetti: Concetto[]): string {
  return concetti.map((c) => `(${c.fts})`).join(" OR ");
}
