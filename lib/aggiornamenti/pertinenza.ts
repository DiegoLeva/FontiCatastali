/**
 * Pertinenza di un atto rispetto al corpus (catasto, cartografia, pubblicita'
 * immobiliare, tributi ipotecari e catastali).
 *
 * L'Agenzia pubblica soprattutto prassi fiscale (codici tributo, ISA,
 * concordato...): importare tutto inquinerebbe il corpus. Due stadi:
 *  1. sui metadati dell'elenco (titolo + oggetto): decide se vale la pena
 *     scaricare il PDF;
 *  2. sul testo del PDF: decide se importare, con soglie su varieta' e
 *     densita' dei termini.
 * Deterministico e spiegabile come il classificatore degli argomenti: il
 * motivo della decisione viene registrato voce per voce.
 */

function normalizza(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[‘’ʼ´`]/g, "'")
    .replace(/\s+/g, " ");
}

/** Termini caratteristici del dominio: uno solo basta a scaricare il PDF. */
const FORTI: Array<[string, RegExp]> = [
  ["catasto", /\bcatast/],
  ["docfa", /\bdocfa\b/],
  ["pregeo", /\bpregeo\b/],
  ["voltura", /\bvoltur/],
  ["planimetria", /\bplanimetri/],
  ["classamento", /\bclassament/],
  ["rendita", /\brendit[ae] (?:catastal|presunt|propost)/],
  ["cartografia", /\bcartografi/],
  ["mappa", /\bmapp(?:a|e|ale|ali) (?:catastal|terren)|\btipo mappale|\btipi mappali/],
  ["estimo", /\bestim[oi]\b/],
  ["ipotecaria", /\bipotecar/],
  ["pubblicita immobiliare", /\bpubblicita immobiliare/],
  ["conservatoria", /\bconservatori[ae]? dei registri|\bregistri immobiliari/],
  ["tributi speciali", /\btributi speciali/],
  ["particella", /\bparticell[ae]\b/],
  ["frazionamento", /\bfrazionament/],
  ["fabbricati rurali", /\bfabbricat\w* rural|\bruralita\b/],
  ["unita immobiliare", /\bunita immobiliar/],
  ["superficie catastale", /\bsuperficie catastal/],
  ["omi", /\bosservatorio del mercato immobiliare|\bquotazioni omi\b/],
  ["intestazione", /\bintestazion\w* catastal/],
  ["accatastamento", /\baccatastament/],
  ["elaborato planimetrico", /\belaborato planimetric/],
  ["punti fiduciali", /\bpunt[oi] fiducial/],
  ["sister", /\bsister\b/],
  ["territorio", /\bagenzia del territorio|\buffici provinciali.{0,10}territorio/],
  ["categoria catastale", /\bcategori[ae] catastal|\bcategoria [a-f] ?\/ ?\d/],
];

/** Termini contigui al dominio: da soli non bastano, servono conferme dal testo. */
const DEBOLI: Array<[string, RegExp]> = [
  ["immobili", /\bimmobil/],
  ["fabbricati", /\bfabbricat/],
  ["terreni", /\bterren[oi]\b/],
  ["successioni", /\bsuccession/],
  ["donazioni", /\bdonazion/],
  ["registro", /\bimposta di registro/],
  ["imu", /\bimu\b/],
  ["edilizia", /\bediliz/],
  ["urbanistica", /\burbanistic/],
  ["compravendita", /\bcompravendit/],
  ["trascrizione", /\btrascrizion/],
];

export interface EsitoMetadati {
  scarica: boolean;
  forti: string[];
  deboli: string[];
}

export function valutaMetadati(titolo: string, oggetto: string): EsitoMetadati {
  const t = normalizza(`${titolo} ${oggetto}`);
  const forti = FORTI.filter(([, re]) => re.test(t)).map(([k]) => k);
  const deboli = DEBOLI.filter(([, re]) => re.test(t)).map(([k]) => k);
  return { scarica: forti.length > 0 || deboli.length > 0, forti, deboli };
}

export interface EsitoTesto {
  pertinente: boolean;
  punteggio: number;
  occorrenze: number;
  distinti: string[];
  motivo: string;
}

/**
 * Decisione sul testo integrale. Soglie tarate per escludere la prassi
 * fiscale che cita la "rendita catastale" di passaggio (es. guide IRPEF) e
 * tenere gli atti in cui il catasto e' l'oggetto.
 */
export function valutaTesto(testo: string, meta: EsitoMetadati): EsitoTesto {
  const t = normalizza(testo);
  let occorrenze = 0;
  const distinti: string[] = [];
  for (const [k, re] of FORTI) {
    const g = new RegExp(re.source, "g");
    const n = (t.match(g) || []).length;
    if (n > 0) {
      occorrenze += n;
      distinti.push(k);
    }
  }
  const densita = occorrenze / Math.max(1, t.length / 10000); // per 10k caratteri
  const punteggio = Math.round((occorrenze + distinti.length * 3 + meta.forti.length * 5) * 10) / 10;

  let pertinente = false;
  let motivo: string;
  if (meta.forti.length > 0 && occorrenze >= 3) {
    pertinente = true;
    motivo = `oggetto catastale (${meta.forti.join(", ")}) confermato dal testo (${occorrenze} occorrenze)`;
  } else if (distinti.length >= 2 && (occorrenze >= 8 || densita >= 2)) {
    pertinente = true;
    motivo = `testo con ${occorrenze} occorrenze di ${distinti.length} termini catastali (${distinti.slice(0, 5).join(", ")})`;
  } else {
    motivo =
      occorrenze === 0
        ? "nessun riferimento catastale nel testo"
        : `riferimenti catastali marginali (${occorrenze} occorrenze: ${distinti.join(", ")})`;
  }
  return { pertinente, punteggio, occorrenze, distinti, motivo };
}
