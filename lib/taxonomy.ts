/**
 * Tassonomia della normativa catastale — 4 livelli di scomposizione.
 *
 *   L1 area  ->  L2 tema  ->  L3 argomento  ->  L4 sotto-argomento
 *
 * Ogni nodo porta un `lessico`: i termini che, trovati nel documento, lo
 * assegnano al nodo. I termini vanno scritti **minuscoli e senza accenti**
 * perche' il confronto avviene su testo normalizzato (vedi lib/classify.ts).
 *
 * La classificazione e' MULTI-ETICHETTA: un documento puo' appartenere a piu'
 * nodi (una circolare sulla rendita degli imbullonati vive sotto A3 e A4.2).
 * I documenti di un nodo comprendono sempre quelli dei suoi discendenti.
 *
 * Questo file e' pensato per essere riletto e corretto nel tempo: aggiungere
 * o togliere un termine non richiede modifiche al resto dell'applicazione.
 */

export interface TaxNode {
  /** Codice gerarchico: "A", "A1", "A1.1", "A1.1.1". */
  id: string;
  label: string;
  lessico: string[];
  figli: TaxNode[];
}

/** Costruttore compatto usato solo qui sotto. */
function n(
  id: string,
  label: string,
  lessico: string[],
  figli: TaxNode[] = []
): TaxNode {
  return { id, label, lessico, figli };
}

export const TASSONOMIA: TaxNode[] = [
  // ===========================================================================
  n("A", "Catasto dei Fabbricati", ["catasto fabbricati", "catasto edilizio urbano", "catasto urbano"], [
    n("A1", "Unita immobiliare urbana", ["unita immobiliare"], [
      n("A1.1", "Nozione di UIU e autonomia funzionale", ["unita immobiliare urbana"], [
        n("A1.1.1", "Autonomia funzionale e reddituale", ["autonomia funzionale", "autonomia reddituale", "cespite indipendente"]),
        n("A1.1.2", "Fusione e divisione di unita", ["fusione di unita immobiliari", "divisione di unita immobiliari", "fusione e divisione"]),
        n("A1.1.3", "Porzioni di unita immobiliare", ["porzione di unita immobiliare", "porzioni di unita immobiliare"]),
      ]),
      n("A1.2", "Beni comuni censibili e non censibili", ["beni comuni"], [
        n("A1.2.1", "Beni comuni non censibili", ["beni comuni non censibili", "bcnc"]),
        n("A1.2.2", "Beni comuni censibili", ["beni comuni censibili", "bcc"]),
        n("A1.2.3", "Parti comuni condominiali", ["parti comuni", "condominio", "parti condominiali"]),
      ]),
      n("A1.3", "Subalterni e identificativi", ["subalterno", "subalterni"], [
        n("A1.3.1", "Attribuzione e revisione dei subalterni", ["attribuzione del subalterno", "revisione dei subalterni", "numerazione dei subalterni"]),
        n("A1.3.2", "Identificativi provvisori e definitivi", ["identificativo provvisorio", "identificativi definitivi", "identificativo catastale"]),
        n("A1.3.3", "Soppressione e costituzione di unita", ["soppressione", "costituzione di unita"]),
      ]),
      n("A1.4", "Aree urbane e corti", ["area urbana", "corte urbana"], [
        n("A1.4.1", "Aree urbane F/1", ["area urbana", "aree urbane"]),
        n("A1.4.2", "Corti e aree scoperte esclusive", ["corte esclusiva", "area scoperta", "aree scoperte"]),
        n("A1.4.3", "Passaggio dal catasto terreni", ["passaggio agli atti del catasto fabbricati", "passaggio dal catasto terreni"]),
      ]),
    ]),
    n("A2", "Categorie e classamento", ["classamento", "categoria catastale", "categorie catastali"], [
      n("A2.1", "Quadro delle categorie catastali", ["quadro generale delle categorie", "gruppi di categorie", "categorie catastali"]),
      n("A2.2", "Gruppo A — abitazioni e uffici", ["gruppo a", "abitazioni"], [
        n("A2.2.1", "A/1, A/8, A/9 — signorili, ville, castelli", ["a/1", "a/8", "a/9", "abitazione di tipo signorile", "ville", "castelli"]),
        n("A2.2.2", "A/2–A/4 — civili, economiche, popolari", ["a/2", "a/3", "a/4", "abitazione di tipo civile", "tipo economico", "tipo popolare"]),
        n("A2.2.3", "A/10 — uffici e studi privati", ["a/10", "uffici e studi privati", "studio privato"]),
        n("A2.2.4", "A/11 — abitazioni tipiche dei luoghi", ["a/11", "abitazioni tipiche dei luoghi", "alloggi tipici"]),
      ]),
      n("A2.3", "Gruppo B — uso collettivo", ["gruppo b"], [
        n("A2.3.1", "B/1–B/2 — collegi, caserme, case di cura", ["b/1", "b/2", "collegi", "caserme", "case di cura"]),
        n("A2.3.2", "B/4–B/5 — uffici pubblici e scuole", ["b/4", "b/5", "uffici pubblici", "scuole"]),
        n("A2.3.3", "B/6–B/8 — musei, cappelle, magazzini sotterranei", ["b/6", "b/7", "b/8", "biblioteche", "musei", "cappelle", "magazzini sotterranei"]),
      ]),
      n("A2.4", "Gruppo C — commerciale e pertinenze", ["gruppo c"], [
        n("A2.4.1", "C/1 — negozi e botteghe", ["c/1", "negozi", "botteghe"]),
        n("A2.4.2", "C/2 — magazzini e locali di deposito", ["c/2", "magazzini e locali di deposito", "locale di deposito"]),
        n("A2.4.3", "C/3 — laboratori artigianali", ["c/3", "laboratori per arti e mestieri", "laboratorio artigianale"]),
        n("A2.4.4", "C/6 — autorimesse e posti auto", ["c/6", "autorimesse", "autorimessa", "posto auto"]),
        n("A2.4.5", "C/7 — tettoie", ["c/7", "tettoie", "tettoia"]),
      ]),
      n("A2.5", "Categorie fittizie F/1–F/6", ["categorie fittizie", "categoria fittizia"], [
        n("A2.5.1", "F/1 — area urbana", ["f/1"]),
        n("A2.5.2", "F/2 — unita collabenti", ["f/2", "unita collabenti", "collabente", "collabenti"]),
        n("A2.5.3", "F/3 — in corso di costruzione", ["f/3", "in corso di costruzione"]),
        n("A2.5.4", "F/4 — in corso di definizione", ["f/4", "in corso di definizione"]),
        n("A2.5.5", "F/5 — lastrico solare", ["f/5", "lastrico solare"]),
        n("A2.5.6", "F/6 — in attesa di dichiarazione", ["f/6", "in attesa di dichiarazione"]),
      ]),
      n("A2.6", "Classi, consistenza e tariffe d'estimo", ["classe catastale", "consistenza catastale"], [
        n("A2.6.1", "Determinazione della classe", ["attribuzione della classe", "classe catastale"]),
        n("A2.6.2", "Consistenza: vani, metri cubi, metri quadri", ["consistenza catastale", "vani catastali", "metri cubi", "metri quadrati"]),
        n("A2.6.3", "Quadro tariffario comunale", ["quadro tariffario", "tariffe d'estimo", "tariffa d'estimo"]),
      ]),
    ]),
    n("A3", "Rendita catastale", ["rendita catastale"], [
      n("A3.1", "Determinazione della rendita", ["determinazione della rendita"], [
        n("A3.1.1", "Criteri e unita di riferimento", ["criteri di determinazione della rendita", "unita di riferimento", "unita tipo"]),
        n("A3.1.2", "Rendita presunta", ["rendita presunta"]),
      ]),
      n("A3.2", "Rendita proposta e rendita d'ufficio", ["rendita proposta"], [
        n("A3.2.1", "Rendita proposta con DOCFA", ["rendita proposta"]),
        n("A3.2.2", "Rettifica entro dodici mesi", ["rettifica entro dodici mesi", "termine di dodici mesi"]),
        n("A3.2.3", "Notifica della rendita", ["notifica della rendita", "notificazione della rendita"]),
      ]),
      n("A3.3", "Rettifica della rendita", ["rettifica della rendita"], [
        n("A3.3.1", "Motivazione dell'atto di classamento", ["motivazione dell'atto di classamento", "obbligo di motivazione"]),
        n("A3.3.2", "Termini e decadenza", ["termini di decadenza", "decadenza del potere"]),
      ]),
    ]),
    n("A4", "Immobili speciali (gruppi D ed E)", ["immobili a destinazione speciale", "destinazione particolare"], [
      n("A4.1", "Stima diretta categorie D ed E", ["stima diretta"], [
        n("A4.1.1", "Procedimento di stima diretta", ["procedimento di stima diretta", "stima diretta"]),
        n("A4.1.2", "Saggio di redditivita e costi", ["saggio di redditivita", "costo di ricostruzione"]),
        n("A4.1.3", "Perizia e relazione di stima", ["relazione di stima", "perizia di stima"]),
      ]),
      n("A4.2", "Imbullonati e impianti fissi", ["imbullonati", "imbullonato", "impianti fissi"], [
        n("A4.2.1", "Legge di stabilita 2016", ["legge di stabilita 2016", "legge 208 del 2015", "208/2015"]),
        n("A4.2.2", "Componenti escluse dalla stima", ["macchinari", "congegni", "attrezzature", "componenti impiantistiche"]),
        n("A4.2.3", "Atti di aggiornamento per lo scorporo", ["scorporo dei macchinari", "atti di aggiornamento per lo scorporo"]),
      ]),
      n("A4.3", "Categorie D — destinazioni produttive", ["categoria d", "opifici"], [
        n("A4.3.1", "D/1 — opifici", ["d/1", "opificio", "opifici"]),
        n("A4.3.2", "D/2 — alberghi e pensioni", ["d/2", "alberghi", "pensioni"]),
        n("A4.3.3", "D/5 — istituti di credito", ["d/5", "istituto di credito", "cambio e assicurazione"]),
        n("A4.3.4", "D/8 — attivita commerciali", ["d/8", "attivita commerciali", "centro commerciale"]),
      ]),
      n("A4.4", "Impianti fotovoltaici, eolici e centrali", ["impianti fotovoltaici", "impianti eolici"], [
        n("A4.4.1", "Impianti fotovoltaici", ["fotovoltaico", "impianto fotovoltaico", "pannelli fotovoltaici"]),
        n("A4.4.2", "Impianti eolici", ["eolico", "aerogeneratore", "torre eolica"]),
        n("A4.4.3", "Centrali e impianti idroelettrici", ["centrale idroelettrica", "impianto idroelettrico", "centrali elettriche"]),
      ]),
      n("A4.5", "Categoria E — destinazioni particolari", ["categoria e"], [
        n("A4.5.1", "E/1–E/3 — stazioni, ponti, edicole", ["e/1", "e/2", "e/3", "stazioni per servizi di trasporto", "ponti comunali", "edicole"]),
        n("A4.5.2", "E/7–E/9 — culto, cimiteri, speciali", ["e/7", "e/8", "e/9", "esercizio pubblico dei culti", "cimiteri"]),
        n("A4.5.3", "Porzioni a destinazione ordinaria", ["porzioni a destinazione ordinaria", "porzione a destinazione ordinaria"]),
      ]),
    ]),
    n("A5", "Superficie catastale", ["superficie catastale"], [
      n("A5.1", "DPR 138/1998 e criteri di calcolo", ["dpr 138", "138/1998"], [
        n("A5.1.1", "Allegato C — norme tecniche", ["allegato c", "norme tecniche per la determinazione della superficie"]),
        n("A5.1.2", "Superfici accessorie e pertinenze", ["superfici accessorie", "pertinenze esclusive"]),
      ]),
      n("A5.2", "Superficie ai fini TARI", ["tari", "tassa rifiuti", "tares"]),
    ]),
  ]),

  // ===========================================================================
  n("B", "Catasto dei Terreni", ["catasto terreni", "catasto dei terreni"], [
    n("B1", "Qualita, classi e redditi", ["qualita di coltura", "reddito imponibile"], [
      n("B1.1", "Reddito dominicale e agrario", ["reddito dominicale", "reddito agrario"], [
        n("B1.1.1", "Rivalutazione dei redditi", ["rivalutazione dei redditi", "coefficiente di rivalutazione"]),
        n("B1.1.2", "Terreni edificabili", ["terreni edificabili", "terreno edificabile"]),
      ]),
      n("B1.2", "Variazioni colturali", ["variazione colturale", "variazioni colturali"], [
        n("B1.2.1", "Dichiarazione AGEA e aggiornamento annuale", ["agea", "dichiarazione agea", "aggiornamento annuale"]),
        n("B1.2.2", "Contestazione delle variazioni colturali", ["contestazione delle variazioni colturali", "ricorso avverso le variazioni colturali"]),
      ]),
      n("B1.3", "Tariffe d'estimo dei terreni", ["tariffe d'estimo dei terreni", "qualita e classe"]),
    ]),
    n("B2", "Fabbricati rurali e ruralita", ["fabbricati rurali", "ruralita"], [
      n("B2.1", "Requisiti di ruralita", ["requisiti di ruralita"], [
        n("B2.1.1", "Art. 9 del DL 557/1993", ["decreto legge 557", "557/1993", "articolo 9 del decreto legge 557"]),
        n("B2.1.2", "Requisiti soggettivi del conduttore", ["coltivatore diretto", "imprenditore agricolo professionale", "iap"]),
        n("B2.1.3", "Abitazioni rurali", ["abitazione rurale", "abitazioni rurali"]),
      ]),
      n("B2.2", "Annotazione di ruralita", ["annotazione di ruralita"], [
        n("B2.2.1", "Domanda di annotazione", ["domanda di annotazione", "annotazione negli atti catastali"]),
        n("B2.2.2", "Autocertificazione e termini", ["autocertificazione", "termine per la presentazione della domanda"]),
      ]),
      n("B2.3", "Fabbricati strumentali agricoli D/10", ["d/10", "fabbricati strumentali", "strumentali all'attivita agricola"]),
    ]),
    n("B3", "Particelle e passaggio al catasto urbano", ["particella", "particelle"], [
      n("B3.1", "Tipo mappale", ["tipo mappale"], [
        n("B3.1.1", "Tipo mappale per nuova costruzione", ["tipo mappale per nuova costruzione"]),
        n("B3.1.2", "Tipo mappale per ampliamento", ["tipo mappale per ampliamento"]),
        n("B3.1.3", "Modello censuario", ["modello censuario"]),
      ]),
      n("B3.2", "Tipo frazionamento", ["tipo di frazionamento", "tipo frazionamento"], [
        n("B3.2.1", "Frazionamento e nuovi identificativi", ["frazionamento", "nuovi identificativi"]),
        n("B3.2.2", "Frazionamento per esproprio", ["esproprio", "espropriazione"]),
      ]),
      n("B3.3", "Tipo particellare", ["tipo particellare"]),
      n("B3.4", "Ente urbano", ["ente urbano", "passaggio al catasto fabbricati"]),
    ]),
    n("B4", "Cartografia catastale", ["cartografia catastale", "mappa catastale"], [
      n("B4.1", "Fogli, mappe ed estratti", ["estratto di mappa", "foglio di mappa"], [
        n("B4.1.1", "Estratto di mappa autentico", ["estratto di mappa autentico", "estratto autentico"]),
        n("B4.1.2", "Rettifica della cartografia", ["rettifica cartografica", "errore cartografico"]),
        n("B4.1.3", "Fogli, allegati e sviluppi", ["foglio di mappa", "sviluppo di mappa", "allegati di mappa"]),
      ]),
      n("B4.2", "Georeferenziazione e sistemi di riferimento", ["georeferenziazione", "sistema di riferimento"], [
        n("B4.2.1", "Sistema Cassini-Soldner", ["cassini soldner", "cassini-soldner"]),
        n("B4.2.2", "Sistema UTM-ETRF2000", ["utm", "etrf2000", "etrs89", "wgs84"]),
        n("B4.2.3", "Punti fiduciali e rete", ["punti fiduciali", "punto fiduciale", "rete dei punti fiduciali"]),
      ]),
    ]),
  ]),

  // ===========================================================================
  n("C", "Atti di aggiornamento e procedure tecniche", ["atti di aggiornamento"], [
    n("C1", "DOCFA", ["docfa"], [
      n("C1.1", "Procedura e versioni DOCFA", ["procedura docfa"], [
        n("C1.1.1", "Versioni della procedura", ["docfa 4", "versione docfa", "nuova versione della procedura"]),
        n("C1.1.2", "Causali di presentazione", ["causale di presentazione", "causali di presentazione"]),
        n("C1.1.3", "Trasmissione telematica", ["trasmissione telematica", "invio telematico"]),
      ]),
      n("C1.2", "Denuncia di nuova costruzione", ["nuova costruzione", "accatastamento"], [
        n("C1.2.1", "Accatastamento di nuovo fabbricato", ["accatastamento", "denuncia di nuova costruzione"]),
        n("C1.2.2", "Termini di presentazione", ["termine di presentazione", "trenta giorni"]),
      ]),
      n("C1.3", "Denuncia di variazione", ["denuncia di variazione", "variazione catastale"], [
        n("C1.3.1", "Diversa distribuzione degli spazi interni", ["diversa distribuzione degli spazi interni", "diversa distribuzione"]),
        n("C1.3.2", "Fusione e frazionamento di UIU", ["fusione di unita immobiliari", "frazionamento di unita immobiliari"]),
        n("C1.3.3", "Ampliamento e demolizione", ["ampliamento", "demolizione"]),
        n("C1.3.4", "Variazione di destinazione", ["variazione della destinazione", "cambio di destinazione"]),
      ]),
      n("C1.4", "Relazione tecnica e allegati", ["relazione tecnica"], [
        n("C1.4.1", "Documenti da allegare", ["documenti da allegare", "elenco degli allegati"]),
        n("C1.4.2", "Dichiarazione di conformita", ["dichiarazione di conformita"]),
      ]),
    ]),
    n("C2", "PREGEO", ["pregeo"], [
      n("C2.1", "Procedura e versioni PREGEO", ["procedura pregeo"], [
        n("C2.1.1", "Versioni della procedura", ["pregeo 10", "versione pregeo"]),
        n("C2.1.2", "Estratto di mappa digitale", ["estratto di mappa digitale"]),
      ]),
      n("C2.2", "Libretto delle misure e proposta di aggiornamento", ["libretto delle misure"], [
        n("C2.2.1", "Rilievo e libretto delle misure", ["libretto delle misure", "rilievo topografico"]),
        n("C2.2.2", "Proposta di aggiornamento", ["proposta di aggiornamento"]),
      ]),
      n("C2.3", "Approvazione automatica e trattazione", ["approvazione automatica"], [
        n("C2.3.1", "Approvazione automatica", ["approvazione automatica"]),
        n("C2.3.2", "Trattazione d'ufficio e scarti", ["trattazione d'ufficio", "atto scartato", "motivi di scarto"]),
      ]),
    ]),
    n("C3", "Planimetrie ed elaborato planimetrico", ["elaborato planimetrico", "planimetria"], [
      n("C3.1", "Elaborato planimetrico ed elenco subalterni", ["elaborato planimetrico"], [
        n("C3.1.1", "Casi di presentazione obbligatoria", ["obbligo di presentazione dell'elaborato", "casi di presentazione"]),
        n("C3.1.2", "Elenco dei subalterni", ["elenco dei subalterni", "elenco subalterni"]),
      ]),
      n("C3.2", "Planimetria catastale e simbologia", ["planimetria catastale"], [
        n("C3.2.1", "Scala e quotature", ["scala 1:200", "quotature"]),
        n("C3.2.2", "Simbologia e altezze", ["simbologia", "altezza dei locali"]),
      ]),
      n("C3.3", "Poligoni e calcolo delle superfici", ["poligoni", "calcolo delle superfici"]),
    ]),
    n("C4", "Volture", ["voltura", "volture"], [
      n("C4.1", "Domanda di voltura", ["domanda di voltura"], [
        n("C4.1.1", "Modello di domanda e termini", ["modello di domanda di voltura", "termine per la voltura"]),
        n("C4.1.2", "Volture in preallineamento", ["preallineamento"]),
      ]),
      n("C4.2", "Voltura automatica e Voltura 2.0", ["voltura automatica"], [
        n("C4.2.1", "Voltura telematica", ["voltura telematica"]),
        n("C4.2.2", "Voltura 2.0", ["voltura 2.0"]),
      ]),
      n("C4.3", "Volture da successione e atti giudiziari", ["atti giudiziari"], [
        n("C4.3.1", "Successioni", ["dichiarazione di successione", "successione"]),
        n("C4.3.2", "Sentenze e decreti di trasferimento", ["decreto di trasferimento", "sentenza"]),
        n("C4.3.3", "Usucapione", ["usucapione"]),
      ]),
    ]),
    n("C5", "Istanze, rettifiche e contenzioso", ["istanza di parte"], [
      n("C5.1", "Istanza di correzione dati", ["istanza di correzione"], [
        n("C5.1.1", "Contact center e istanze online", ["contact center", "istanza online"]),
        n("C5.1.2", "Correzione dati anagrafici", ["dati anagrafici", "intestazione catastale"]),
        n("C5.1.3", "Correzione dati oggettivi", ["dati oggettivi", "errore materiale"]),
      ]),
      n("C5.2", "Autotutela catastale", ["autotutela"]),
      n("C5.3", "Ricorsi e contenzioso sul classamento", ["contenzioso tributario"], [
        n("C5.3.1", "Corte di giustizia tributaria", ["corte di giustizia tributaria", "commissione tributaria"]),
        n("C5.3.2", "Onere della motivazione", ["obbligo di motivazione", "motivazione dell'avviso"]),
        n("C5.3.3", "Giurisprudenza di legittimita", ["corte di cassazione", "cassazione"]),
      ]),
    ]),
  ]),

  // ===========================================================================
  n("D", "Pubblicita immobiliare", ["pubblicita immobiliare", "conservatoria"], [
    n("D1", "Trascrizioni e iscrizioni", ["trascrizione", "iscrizione"], [
      n("D1.1", "Nota di trascrizione", ["nota di trascrizione"], [
        n("D1.1.1", "Compilazione e modelli", ["modello di nota", "compilazione della nota"]),
        n("D1.1.2", "Rettifica della nota", ["rettifica della nota"]),
      ]),
      n("D1.2", "Iscrizioni ipotecarie e annotamenti", ["iscrizione ipotecaria", "ipoteca"], [
        n("D1.2.1", "Iscrizione e rinnovazione", ["rinnovazione dell'ipoteca", "iscrizione ipotecaria"]),
        n("D1.2.2", "Cancellazione e restrizione", ["cancellazione dell'ipoteca", "restrizione dell'ipoteca"]),
      ]),
    ]),
    n("D2", "Ispezioni e visure ipotecarie", ["ispezione ipotecaria", "visura ipotecaria"], [
      n("D2.1", "Ispezione telematica", ["ispezione telematica"]),
      n("D2.2", "Certificati e relazioni notarili", ["relazione notarile", "certificato ipotecario"]),
      n("D2.3", "Ispezione per soggetto e per immobile", ["ispezione per soggetto", "ispezione per immobile"]),
    ]),
    n("D3", "Allineamento catasto–conservatoria", ["allineamento delle banche dati"], [
      n("D3.1", "Adempimento unico (MUI)", ["adempimento unico", "modello unico informatico"], [
        n("D3.1.1", "Modello unico informatico", ["modello unico informatico", "mui"]),
        n("D3.1.2", "Errori e rettifiche", ["rettifica dell'adempimento unico", "errore nell'adempimento unico"]),
      ]),
      n("D3.2", "Discordanze su soggetti e anagrafica", ["discordanza", "dati anagrafici dei soggetti"]),
    ]),
  ]),

  // ===========================================================================
  n("E", "Fiscalita immobiliare", ["imposta", "tributo"], [
    n("E1", "IMU e tributi locali", ["imu", "ici", "tasi"], [
      n("E1.1", "Base imponibile e rendita", ["base imponibile", "rendita rivalutata"]),
      n("E1.2", "Abitazione principale ed esenzioni", ["abitazione principale", "esenzione imu"]),
      n("E1.3", "Aree fabbricabili", ["area fabbricabile", "aree fabbricabili"]),
      n("E1.4", "Fabbricati rurali strumentali", ["fabbricati rurali strumentali"]),
      n("E1.5", "Immobili merce e collabenti", ["immobili merce", "beni merce", "fabbricati collabenti"]),
    ]),
    n("E2", "Registro, ipotecaria e catastale", ["imposta di registro", "imposta ipotecaria", "imposta catastale"], [
      n("E2.1", "Valore catastale e moltiplicatori", ["valore catastale"], [
        n("E2.1.1", "Moltiplicatori per categoria", ["moltiplicatore", "moltiplicatori"]),
        n("E2.1.2", "Rivalutazione delle rendite", ["rivalutazione delle rendite", "rivalutazione del 5 per cento"]),
      ]),
      n("E2.2", "Prezzo-valore", ["prezzo valore", "prezzo-valore"], [
        n("E2.2.1", "Ambito di applicazione", ["ambito di applicazione del prezzo valore"]),
        n("E2.2.2", "Richiesta resa in atto", ["richiesta resa in atto", "dichiarazione resa in atto"]),
      ]),
    ]),
    n("E3", "Agevolazioni", ["agevolazione", "agevolazioni"], [
      n("E3.1", "Prima casa", ["prima casa"], [
        n("E3.1.1", "Requisiti e dichiarazioni", ["requisiti prima casa", "dichiarazione di residenza"]),
        n("E3.1.2", "Decadenza e riacquisto", ["decadenza dalle agevolazioni", "riacquisto"]),
        n("E3.1.3", "Pertinenze agevolate", ["pertinenze agevolate", "pertinenza dell'abitazione"]),
      ]),
      n("E3.2", "Abitazioni di lusso (A/1, A/8, A/9)", ["abitazioni di lusso", "immobili di lusso"]),
    ]),
    n("E4", "Tributi speciali catastali e diritti", ["tributi speciali catastali", "diritti catastali"], [
      n("E4.1", "Tabella dei tributi speciali", ["tabella dei tributi speciali", "tributi speciali"]),
      n("E4.2", "Esenzioni e riduzioni", ["esenzione dai tributi", "riduzione dei tributi"]),
      n("E4.3", "Modalita di versamento", ["modalita di versamento", "f24 elide"]),
    ]),
    n("E5", "Successioni e donazioni", ["successione", "donazione"], [
      n("E5.1", "Dichiarazione di successione telematica", ["dichiarazione di successione telematica"]),
      n("E5.2", "Voltura automatica da successione", ["voltura automatica da successione"]),
      n("E5.3", "Prima casa in successione", ["agevolazione prima casa successione"]),
    ]),
  ]),

  // ===========================================================================
  n("F", "Revisione, qualita e riforma della banca dati", ["revisione del classamento", "riforma del catasto"], [
    n("F1", "Revisione del classamento", ["revisione del classamento"], [
      n("F1.1", "Comma 335 — microzone", ["comma 335"], [
        n("F1.1.1", "Presupposti e procedura", ["presupposti della revisione", "procedura di revisione"]),
        n("F1.1.2", "Motivazione dell'atto di revisione", ["motivazione dell'atto di revisione"]),
      ]),
      n("F1.2", "Comma 336 — segnalazioni comunali", ["comma 336"], [
        n("F1.2.1", "Segnalazione del Comune", ["segnalazione del comune", "richiesta del comune"]),
        n("F1.2.2", "Decorrenza degli effetti", ["decorrenza degli effetti", "efficacia della revisione"]),
      ]),
      n("F1.3", "Riclassamento d'ufficio", ["riclassamento d'ufficio", "riclassamento"]),
    ]),
    n("F2", "Microzone catastali", ["microzona", "microzone"], [
      n("F2.1", "Individuazione e revisione delle microzone", ["individuazione delle microzone", "revisione delle microzone"]),
      n("F2.2", "Scostamento tra valori di mercato e catastali", ["scostamento", "rapporto tra valore di mercato e valore catastale"]),
    ]),
    n("F3", "Immobili non dichiarati", ["immobili non dichiarati"], [
      n("F3.1", "Case fantasma", ["case fantasma", "fabbricati mai dichiarati"], [
        n("F3.1.1", "Individuazione e pubblicazione", ["pubblicazione degli elenchi", "elenchi dei comuni"]),
        n("F3.1.2", "Attribuzione di rendita presunta", ["rendita presunta"]),
      ]),
      n("F3.2", "Ex rurali e accertamento d'ufficio", ["ex rurali", "accertamento d'ufficio"]),
    ]),
    n("F4", "Riforma del catasto e banche dati", ["banca dati catastale"], [
      n("F4.1", "OMI e valori immobiliari", ["omi", "osservatorio del mercato immobiliare"], [
        n("F4.1.1", "Banca dati OMI e quotazioni", ["banca dati omi", "quotazioni immobiliari"]),
        n("F4.1.2", "Zone OMI", ["zona omi", "zone omi"]),
      ]),
      n("F4.2", "Anagrafe immobiliare integrata", ["anagrafe immobiliare integrata"], [
        n("F4.2.1", "Integrazione delle banche dati", ["integrazione delle banche dati", "allineamento delle banche dati"]),
        n("F4.2.2", "Attestazione integrata", ["attestazione integrata"]),
      ]),
    ]),
  ]),

  // ===========================================================================
  n("G", "Conformita, edilizia e urbanistica", ["conformita", "urbanistica"], [
    n("G1", "Conformita catastale", ["conformita catastale"], [
      n("G1.1", "Conformita oggettiva e soggettiva", ["conformita oggettiva", "conformita soggettiva"], [
        n("G1.1.1", "Conformita oggettiva", ["conformita oggettiva", "planimetria depositata", "stato di fatto"]),
        n("G1.1.2", "Conformita soggettiva", ["conformita soggettiva", "intestatario catastale"]),
      ]),
      n("G1.2", "Dichiarazione di conformita negli atti", ["dichiarazione di conformita catastale"], [
        n("G1.2.1", "Art. 29 c. 1-bis L. 52/1985", ["comma 1-bis", "legge 52 del 1985", "articolo 29"]),
        n("G1.2.2", "Nullita dell'atto", ["nullita dell'atto"]),
      ]),
    ]),
    n("G2", "Difformita e regolarizzazione", ["difformita"], [
      n("G2.1", "Sanatoria e condono edilizio", ["condono edilizio", "sanatoria edilizia"], [
        n("G2.1.1", "Condono edilizio", ["condono edilizio"]),
        n("G2.1.2", "Accertamento di conformita", ["accertamento di conformita"]),
      ]),
    ]),
    n("G3", "Titoli edilizi e agibilita", ["titolo edilizio", "agibilita"], [
      n("G3.1", "Permesso di costruire, SCIA e CILA", ["permesso di costruire", "scia", "cila"]),
      n("G3.2", "Segnalazione certificata di agibilita", ["segnalazione certificata di agibilita", "certificato di agibilita"]),
      n("G3.3", "Rapporto tra titolo edilizio e catasto", ["coerenza urbanistico catastale", "rapporto tra titolo edilizio e catasto"]),
    ]),
    n("G4", "Cambio di destinazione d'uso", ["destinazione d'uso"], [
      n("G4.1", "Mutamento con e senza opere", ["mutamento di destinazione", "senza opere", "con opere"]),
      n("G4.2", "Riflessi sul classamento", ["riflessi sul classamento", "effetti sul classamento"]),
    ]),
  ]),

  // ===========================================================================
  n("H", "Servizi e accesso ai dati", ["servizi telematici", "consultazione"], [
    n("H1", "Visure e certificazioni", ["visura", "visure"], [
      n("H1.1", "Visura per immobile e per soggetto", ["visura per immobile", "visura per soggetto"]),
      n("H1.2", "Visura storica", ["visura storica"]),
      n("H1.3", "Certificazione catastale", ["certificato catastale", "certificazione catastale"]),
    ]),
    n("H2", "Sister e servizi telematici", ["sister"], [
      n("H2.1", "Accesso e convenzioni", ["convenzione sister", "accesso a sister"]),
      n("H2.2", "Servizi per i professionisti", ["servizi per i professionisti", "utenti abilitati"]),
      n("H2.3", "Interoperabilita e cooperazione applicativa", ["cooperazione applicativa", "interoperabilita"]),
    ]),
    n("H3", "Consultazione, privacy e riuso", ["privacy", "riuso dei dati"], [
      n("H3.1", "Consultazione personale", ["consultazione personale"]),
      n("H3.2", "Trattamento dei dati personali", ["dati personali", "gdpr", "protezione dei dati"]),
      n("H3.3", "Open data e riuso", ["open data", "riuso dei dati"]),
    ]),
    n("H4", "Cartografia online e servizi WMS", ["wms", "cartografia online"], [
      n("H4.1", "Servizio di consultazione WMS", ["servizio wms", "consultazione cartografica"]),
      n("H4.2", "Estrazione e download cartografico", ["download della cartografia", "estrazione cartografica"]),
    ]),
  ]),

  // ===========================================================================
  n("I", "Regimi speciali e organizzazione", ["regime speciale"], [
    n("I1", "Sistema tavolare (libro fondiario)", ["sistema tavolare", "libro fondiario", "tavolare"], [
      n("I1.1", "Province autonome di Trento e Bolzano", ["provincia autonoma di trento", "provincia autonoma di bolzano"], [
        n("I1.1.1", "Catasto fondiario e libro fondiario", ["catasto fondiario", "libro fondiario"]),
        n("I1.1.2", "Competenze provinciali", ["competenze provinciali", "delega alle province autonome"]),
      ]),
      n("I1.2", "Friuli Venezia Giulia", ["friuli venezia giulia", "gorizia", "trieste"]),
    ]),
    n("I2", "Eventi sismici e calamita", ["evento sismico", "sisma", "terremoto", "calamita"], [
      n("I2.1", "Esenzioni e sospensioni", ["sospensione dei termini"], [
        n("I2.1.1", "Sospensione dei termini", ["sospensione dei termini"]),
        n("I2.1.2", "Inagibilita ed esenzioni", ["inagibilita", "inagibile", "esenzione per inagibilita"]),
      ]),
      n("I2.2", "Ricostruzione e schede AeDES", ["aedes", "scheda aedes", "ricostruzione"]),
    ]),
    n("I3", "Professionisti e adempimenti", ["professionista", "tecnico abilitato"], [
      n("I3.1", "Tecnici abilitati e firma digitale", ["tecnico abilitato"], [
        n("I3.1.1", "Professionisti abilitati", ["professionisti abilitati", "albo professionale"]),
        n("I3.1.2", "Firma digitale", ["firma digitale", "sottoscrizione digitale"]),
      ]),
      n("I3.2", "Deleghe e incarichi", ["delega", "incarico professionale"]),
    ]),
    n("I4", "Sanzioni catastali", ["sanzione", "sanzioni"], [
      n("I4.1", "Omessa dichiarazione", ["omessa dichiarazione", "omessa presentazione"]),
      n("I4.2", "Ravvedimento e riduzioni", ["ravvedimento operoso", "riduzione della sanzione"]),
    ]),
    n("I5", "Organizzazione degli uffici", ["organizzazione degli uffici"], [
      n("I5.1", "Uffici provinciali — Territorio", ["ufficio provinciale territorio", "direzione provinciale"]),
      n("I5.2", "Competenze e circolari organizzative", ["competenze degli uffici", "circolare organizzativa"]),
    ]),
  ]),
];

/**
 * Nodo di servizio: documenti che nessuna regola ha intercettato. Resta
 * visibile con il suo conteggio — una mappa che finge copertura totale e'
 * peggio di una che ammette il residuo.
 */
export const NODO_RESIDUO = "residuo";
export const LABEL_RESIDUO = "Da classificare";

export interface FlatNode {
  id: string;
  label: string;
  lessico: string[];
  /** id del genitore, "" per le aree di primo livello */
  parent: string;
  /** 1 = area, 2 = tema, 3 = argomento, 4 = sotto-argomento */
  depth: number;
  figli: string[];
}

/** Indice piatto della tassonomia, costruito una volta sola. */
export const NODI: Map<string, FlatNode> = (() => {
  const map = new Map<string, FlatNode>();
  const visit = (node: TaxNode, parent: string, depth: number) => {
    if (map.has(node.id)) {
      throw new Error(`Tassonomia: id duplicato "${node.id}"`);
    }
    map.set(node.id, {
      id: node.id,
      label: node.label,
      lessico: node.lessico,
      parent,
      depth,
      figli: node.figli.map((c) => c.id),
    });
    for (const child of node.figli) visit(child, node.id, depth + 1);
  };
  for (const area of TASSONOMIA) visit(area, "", 1);
  return map;
})();

/** Catena di antenati (dal piu' esterno) piu' il nodo stesso. */
export function percorso(id: string): FlatNode[] {
  const out: FlatNode[] = [];
  let cur = NODI.get(id);
  while (cur) {
    out.unshift(cur);
    cur = cur.parent ? NODI.get(cur.parent) : undefined;
  }
  return out;
}
