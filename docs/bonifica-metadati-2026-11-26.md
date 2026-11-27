# Bonifica dei metadati del corpus — 26 novembre 2026

Esecuzione reale (n. 5) sul database di produzione, dopo tre prove a secco riviste a mano. Regole in `lib/metadati/normalizza.ts`, runner in `lib/metadati/bonifica.ts`; ogni modifica è registrata con il valore precedente nella tabella `metadati_bonifica` (reversibile). La seconda esecuzione non trova nulla da cambiare (idempotente).

## Riepilogo

| Voce | Valore |
|---|---|
| Documenti esaminati | 2.187 |
| Documenti con metadati normalizzati (`documenti_meta`) | 2.187 |
| Documenti corretti in `documenti` | 52 |
| Anni corretti | 32 |
| di cui anni mancanti recuperati | 4 |
| Titoli inservibili ricostruiti | 20 |
| Documenti con estremi normalizzati | 1.459 |
| Documenti con data dell'atto | 675 |
| Tipologie ricavate dall'intestazione del testo | 557 |
| Duplicati esatti (esclusi da ricerca, Studio e Normie) | 318 |
| Casi ambigui da revisionare (nessuna modifica) | 198 |

## Tipologie normalizzate

| Tipologia | Documenti |
|---|---|
| Circolare | 587 |
| Nota | 206 |
| Provvedimento | 194 |
| Decreto | 167 |
| Istruzione | 114 |
| Nota di chiarimento | 113 |
| Guida | 108 |
| Comunicato stampa | 84 |
| Risoluzione | 77 |
| Materiale didattico | 76 |
| Legge | 69 |
| Procedura operativa | 54 |
| Slide | 43 |
| Direttiva | 43 |
| Modulistica | 40 |
| Sentenza | 39 |
| Determinazione | 35 |
| Decreto-legge | 18 |
| Articolo di legge | 18 |
| Documento demaniale | 17 |
| Linee guida | 16 |
| Manuale | 15 |
| Massimario | 12 |
| Decreto legislativo | 10 |
| D.P.R. | 7 |
| Sanzioni | 6 |
| Documento | 6 |
| Decreto ministeriale | 5 |
| Allegato | 4 |
| Regio decreto | 2 |
| Accordo | 1 |
| Tabella | 1 |

## Correzioni applicate

| Doc | Campo | Prima | Dopo | Motivo |
|---|---|---|---|---|
| #88 Circ. 30 E - Approvazione aggiornamento catasto terreni | anno | 2015 | 2014 | intestazione: Circolare n. 30/E del 29 dicembre 2014 |
| #136 Circ. 2 - Disciplina censimento fabbricati rurali | anno | 2011 | 2012 | intestazione: Circolare n. 2/2012 del 7 agosto 2012 |
| #276 Circ. 3 - Codici annotazione variazioni censuarie catastali | anno | 2001 | 2009 | intestazione: Circolare n. 3 del 16 ottobre 2009 |
| #280 Circ. 1 - Competenza professionale degli Agrotecnici | anno | 2000 | 2002 | intestazione: Circolare n. 1 del 7 febbraio 2002 |
| #285 Circ. 2 - Sanzioni amministrative per violazioni norme catas | anno | 2000 | 2002 | intestazione: Circolare n. 2 del 17 aprile 2002 |
| #288 Circ. 5 - Trascrivibilità atti di destinazione per fini meri | anno | 2000 | 2006 | intestazione: Circolare n. 5/2006 del 7 agosto 2006 |
| #375 Circ. 3 - Elenco delle deroghe catastali vigenti | anno | 1989 | 2009 | intestazione: Circolare n. 3 del 16 ottobre 2009 |
| #400 Circ. 6 - Estinzione anticipata del finanziamento | anno | 1973 | 2007 | intestazione: Circolare n. 6 del 14 giugno 2007 |
| #403 Circ. 12 - Individuazione presupposto oggettivo articolo 15 | anno | 1973 | 2002 | intestazione: Circolare n. 12/2002 del 27 dicembre 2002 |
| #404 Circ. 6 - Innovazioni procedurali per voltura catastale | anno | 1972 | 2002 | intestazione: Circolare n. 6 del 13 agosto 2002 |
| #412 Circ. 2 - Esenzione tributi speciali catastali enti locali | anno | 1954 | 2009 | intestazione: Circolare n. 2/2009 del 14 luglio 2009 |
| #572 Corso | titolo | Corso | Tabella Corrispondenza Vani Superfici Minime Massime Bergamo | titolo inservibile («Corso») |
| #577 Corso | titolo | Corso | Tabella Corrispondenza Vani Superfici Minime Massime Macerata | titolo inservibile («Corso») |
| #587 DL 2002 - Rendimento energetico nell'edilizia | anno | 2015 | 2005 | intestazione: Decreto legislativo n. 192 del 19 agosto 2005 |
| #607 Regole tecniche per Repertorio nazionale dati territoriali | anno | 2008 | 2011 | intestazione: Decreto del 10 novembre 2011 |
| #613 Proroga termini per adeguamento antincendio strutture ricett | anno | 2006 | 2005 | intestazione: Decreto-legge n. 273 del 30 dicembre 2005 |
| #646 Formazione del catasto edilizio urbano | anno | 1979 | 1949 | intestazione: D.P.R. n. 1142 del 1 dicembre 1949 |
| #932 Legge 3682 - Formazione del catasto geometrico particellare | anno | 2000 | 1886 | intestazione: Legge n. 3682 del 1 marzo 1886 |
| #933 Legge 3682 - Formazione del catasto geometrico particellare  | anno | 2000 | 1886 | intestazione: Legge n. 3682 del 1 marzo 1886 |
| #984 Mod. | titolo | Mod. | Modulo Visura Catastale 2010 | titolo inservibile («Mod.») |
| #995 Mod. | titolo | Mod. | Preventivo Spesa Prestazione Professionale | titolo inservibile («Mod.») |
| #996 Mod. | titolo | Mod. | Deposito Comune TM TF Esempio | titolo inservibile («Mod.») |
| #997 Mod. | titolo | Mod. | Disciplinare Tipo Incarico Professionale | titolo inservibile («Mod.») |
| #998 Mod. | titolo | Mod. | Domanda Tipo Certificato Destinazione Urbanistica | titolo inservibile («Mod.») |
| #999 Mod. | titolo | Mod. | Modulo Istanza Correzione Rettifica | titolo inservibile («Mod.») |
| #1000 Mod. | titolo | Mod. | Modulo Richiesta Estratto Aggiornamento Cartografico | titolo inservibile («Mod.») |
| #1001 Mod. | titolo | Mod. | Modulo Istanza Autotutela | titolo inservibile («Mod.») |
| #1002 Mod. | titolo | Mod. | Modulo Delega Accesso Planimetrie | titolo inservibile («Mod.») |
| #1003 Mod. | titolo | Mod. | Modulo Richiesta Spostamento Particelle Altro Foglio | titolo inservibile («Mod.») |
| #1004 Mod. | titolo | Mod. | Modulo Richiesta Accorpamento Porzioni Agea | titolo inservibile («Mod.») |
| #1005 Mod. | titolo | Mod. | Modulo Delega Ritiro Presentazione Pratiche Catastale | titolo inservibile («Mod.») |
| #1006 Mod. | titolo | Mod. | Modulo Dichiarazione Sostitutiva | titolo inservibile («Mod.») |
| #1007 Mod. | titolo | Mod. | Modulo Dichiarazione Sostitutiva Certificato Morte | titolo inservibile («Mod.») |
| #1008 Mod. | titolo | Mod. | Modulo Dichiarazione Sostitutiva Atto Notoriet Passaggi Convalidati | titolo inservibile («Mod.») |
| #1009 Mod. | titolo | Mod. | Modulo Dichiarazione Sostitutiva Atto Notoriet Passaggi Registrati | titolo inservibile («Mod.») |
| #1011 Mod. | titolo | Mod. | Parcelle Lavori Catastali Bozza | titolo inservibile («Mod.») |
| #1014 Mod. | titolo | Mod. | Verbale Tipo Giuramento Perizia | titolo inservibile («Mod.») |
| #1148 Prov. 14 - Estensione procedure telematiche per atti immobil | anno | 2006 | 2007 | intestazione: Provvedimento del 14 marzo 2007 |
| #1160 Aggiornamento del valore medio di mercato immobiliare | anno | 2005 | 2004 | intestazione: Provvedimento del 30 dicembre 2004 |
| #1170 Prov. 2 - Estensione servizio trasmissione telematica catast | anno | 2001 | 2006 | intestazione: Provvedimento del 2 maggio 2006 |
| #1171 Prov. 13 - Estensione servizio trasmissione telematica catas | anno | 2001 | 2006 | intestazione: Provvedimento del 13 luglio 2006 |
| #1173 Prov. 52900 - Estensione servizio trasmissione telematica ca | anno | 1972 | 2010 | intestazione: Provvedimento n. 52900 del 13 ottobre 2010 |
| #1178 Ris. 1 E - Aggiornamento del Catasto Terreni e mappa | anno | 2016 | 2020 | intestazione: Risoluzione n. 1/E del 7 gennaio 2020 |
| #1215 Ris. 214 E - Eredità devolute a minori e interdetti | anno | 2002 | 2009 | intestazione: Risoluzione n. 214/E del 11 agosto 2009 |
| #1711 Legge 3682 - Formazione del catasto geometrico particellare  | anno | 2000 | 1886 | intestazione: Legge n. 3682 del 1 marzo 1886 |
| #1712 Legge 3682 - Formazione del catasto geometrico particellare | anno | 2000 | 1886 | intestazione: Legge n. 3682 del 1 marzo 1886 |
| #1809 Nota 24701 - Sanctioni Docfa e Pregeo catastali | anno | 2015 | 2013 | intestazione: Nota n. 24701 del 20 giugno 2013 |
| #2484 Circolare Demanio Marittimo | anno | s.d. | 2008 | data di firma «Roma, 4 marzo 2008» |
| #2498 circolare_controlli_docfa | anno | s.d. | 2004 | intestazione: 13 febbraio 2004 |
| #2508 circolare_istruzioni_comunicazioni_L40_2007 | anno | 2007 | 2008 | intestazione: Circolare n. 2/2008 del 20 febbraio 2008 |
| #2520 decreto_convenzione_collegamento_telematico | anno | s.d. | 2008 | intestazione: 6 giugno 2008 |
| #2536 Risoluzione_nuova_versione_Pregeo_accessibile | anno | s.d. | 2024 | intestazione: 18 aprile 2024 |

## Duplicati esatti (campione)

Stesso testo estratto (lunghezza, inizio e fine identici). Il documento canonico resta; le copie restano nel catalogo ma non si ripetono in ricerca, Studio e Normie.

| Copia | Canonico |
|---|---|
| #34 (2012) Cancellazione vincoli enfiteutici catastali | #30 (2012) Chiar. 17 - Cancellazione vincoli enfiteutici catastali |
| #77 (1972) Cancellazione vincoli enfiteutici da atti catastali | #30 (2012) Chiar. 17 - Cancellazione vincoli enfiteutici catastali |
| #120 (2012) Circ. 6 - Rendita catastale unità immobiliari speciali | #109 (2012) Circ. 6 - Rendita catastale unità immobiliari speciali |
| #122 (2012) Circ. 2 - Modifiche alla procedura Docfa per ruralità | #116 (2012) Circ. 2 - Modifiche alla procedura Docfa e ruralità |
| #136 (2011) Circ. 2 - Disciplina censimento fabbricati rurali | #118 (2012) Circ. 22012 - Disciplina censimento fabbricati rurali |
| #139 (2011) Circ. 72011 - Registrazione rendita presunta catastale | #134 (2011) Circ. 7 - Registrazione della rendita presunta catastal |
| #161 (2009) Circ. 3 - Aggiornamento automatico del Catasto Terreni | #152 (2009) Circ. 3 - Aggiornamento automatico del Catasto Terreni |
| #167 (2009) Circ. 3 - Categorie di controlli della procedura Pregeo | #158 (2009) Circ. 3 - Categorie di controlli della procedura Pregeo |
| #168 (2009) Circ. 3 - Dichiarazioni tecniche per deroghe catastali | #157 (2009) Circ. 3 - Dichiarazioni tecniche per deroghe catastali |
| #169 (2009) Circ. 3 - Informazioni aggiuntive nell'estratto di mapp | #154 (2009) Circ. 3 - Informazioni aggiuntive nell'estratto di mapp |
| #170 (2009) Circ. 3 - Nuova interfaccia grafica per la cartografia  | #159 (2009) Circ. 3 - Nuova interfaccia grafica per catasto immobil |
| #171 (2009) Circ. 3 - Tipologie di atti di aggiornamento catastale | #155 (2009) Circ. 3 - Tipologie di atti di aggiornamento catastale |
| #172 (2008) Circ. 3 - Accertamento immobili con impianti fotovoltai | #124 (2012) Circ. 3 - Accertamento immobili con impianti fotovoltai |
| #184 (2007) Circ. 12007 - Procedura Pregeo 9 e direttive aggiornate | #183 (2007) Circ. 1 - Procedura Pregeo 9 e direttive aggiornate |
| #191 (2007) Circ. 2 - Trasmissione telematica modello unico catasta | #185 (2007) Circ. 22007 - Trasmissione telematica modello unico cat |
| #192 (2007) Circ. 1 - Procedura Pregeo 9 e direttive aggiornate | #183 (2007) Circ. 1 - Procedura Pregeo 9 e direttive aggiornate |
| #196 (2006) Circ. 2 - Procedura Pregeo 9 e modelli informatizzati | #195 (2006) Circ. 2 - Procedura Pregeo 9 e modelli informatizzati |
| #214 (2005) Circ. 8 - Controlli sugli atti di aggiornamento cartogr | #213 (2005) Circ. 8 - Controlli sugli atti di aggiornamento cartogr |
| #216 (2005) Circ. 8 - Controlli sugli atti di aggiornamento cartogr | #213 (2005) Circ. 8 - Controlli sugli atti di aggiornamento cartogr |
| #218 (2005) Circ. 4 T - Trasmissione telematica modello unico catas | #212 (2005) Circ. 4 - Trasmissione telematica modello unico catasta |
| #235 (2004) Circ. 3 - Integrazione elenco diritti reali sugli immob | #234 (2004) Circ. 3 - Integrazione elenco diritti reali sugli immob |
| #239 (2004) Circ. 57211 - Richiesta informazioni su sedi di uffici | #57 (2004) Chiar. 57211 - Richiesta informazioni catastali |
| #250 (2003) Circ. 10 - Richiesta di certificato di destinazione urb | #245 (2003) Circ. 10 - Richiesta di certificato di destinazione urb |
| #274 (2001) Circ. 9 - Attivazione procedura Docfa versione 3 punto  | #268 (2001) Circ. 9 - Attivazione procedura Docfa versione 3 punto  |
| #275 (2001) Circ. 1 - Aggiornamento cartografico catastale | #267 (2001) Circ. 1 - Aggiornamento cartografico catastale |
| #276 (2001) Circ. 3 - Codici annotazione variazioni censuarie catas | #160 (2009) Circ. 3 - Codici annotazione variazioni censuarie catas |
| #323 (1996) Circ. 49 - Dichiarazioni per accertamento unità immobil | #69 (1996) Circ. 49 T - Dichiarazioni unità immobiliari urbane |
| #325 (1996) Circ. 49 T - Aggiornamento degli archivi catastali | #324 (1996) Circ. 49 T - Aggiornamento degli archivi catastali |
| #365 (1989) Circ. 4 - Accorgimenti tecnici per rilievo catastale | #346 (1992) Circ. 4 - Accorgimenti tecnici per rilievo catastale |
| #375 (1989) Circ. 3 - Elenco delle deroghe catastali vigenti | #156 (2009) Circ. 3 - Elenco delle deroghe catastali vigenti |
| #414 (1941) Circ. 134 - Quadro generale delle categorie catastali | #413 (1942) Circ. 60 - Quadro generale delle categorie catastali |
| #485 (2011) Aggiornamento catastale dei fabbricati rurali | #484 (2013) Aggiornamento catastale dei fabbricati rurali |
| #489 (2009) Slide 1 - Iscrizione immobili al catasto | #488 (2009) Slide 1 - Iscrizione immobili al catasto |
| #504 (1992) Dichiarazione unità immobiliari in categoria F2 | #481 (2013) Dichiarazione unità immobiliari in categoria F2 |
| #518 (2013) Corso 112009 - Aggiornamento intestazioni catastali imm | #507 (1988) Slide 112009 - Aggiornamento intestazioni catastali imm |
| #595 (2012) Revisione della spesa pubblica | #594 (2012) Revisione della spesa pubblica |
| #636 (1994) Norme per automazione procedure catastali | #635 (1994) Decr. 701 - Norme per automazione procedure catastali |
| #639 (1993) Istituzione del catasto dei fabbricati | #637 (1993) Istituzione del catasto dei fabbricati |
| #649 (1972) Perfezionamento del sistema catastale | #406 (1972) Perfezionamento del sistema catastale |
| #651 (1969) Revisione criteri accatastamento fabbricati rurali | #632 (1998) Revisione criteri accatastamento fabbricati rurali |

## Casi da revisionare

Segnalati e NON modificati: servono un controllo a mano sul PDF.

| Doc | Cartella | Anno | Titolo | Motivi |
|---|---|---|---|---|
| #24 | 01 - Chiarimenti | 2013 | Circ. 12 E - Novità fiscali e disposizioni tributarie | il testo si apre come Circolare n. 12/E, ma la scheda indica Nota di chiarimento |
| #32 | 01 - Chiarimenti | 2012 | Circ. 12012 - Schede esemplificative di atti di aggiornament | il testo si apre come Circolare n. 1, ma la scheda indica Nota di chiarimento |
| #40 | 01 - Chiarimenti | 2010 | Chiar. 4 - Attivazione versione procedura DOCFA | il testo si apre come Nota n. 4, ma la scheda indica Nota di chiarimento |
| #58 | 01 - Chiarimenti | 2004 | Chiar. 8304 - Chiarimenti su Pregeo 8 a regime operativo | anno 2004 registrato, ma il testo cita il 2008 |
| #62 | 01 - Chiarimenti | 2002 | Chiar. 36363 - Presentazione elaborato planimetrico in denun | il testo si apre come Nota n. 36363, ma la scheda indica Nota di chiarimento |
| #74 | 01 - Chiarimenti | 1992 | Vincolo pertinenziale aree ai fini ICI | anno 1992 registrato, ma il testo cita il 2005 |
| #77 | 01 - Chiarimenti | 1972 | Cancellazione vincoli enfiteutici da atti catastali | anno 1972 registrato, ma il testo cita il 2011 |
| #131 | 02 - Circolari | 2011 | Circ. 3 - Aggiornamento del Catasto Terreni automatico | il nome indica il n. 3, l'intestazione il n. 2 |
| #163 | 02 - Circolari | 2009 | Circ. 589 - Istituzione e variazione punti fiduciali catasta | il nome indica il n. 589, l'intestazione il n. 5 |
| #187 | 02 - Circolari | 2007 | Circ. 3 - Istruzioni per compilazione comunicazioni telemati | il nome indica il n. 3, l'intestazione il n. 2/2008; anno 2007 registrato, ma il testo è datato 20 febbraio 2008 |
| #228 | 02 - Circolari | 2005 | Circ. 22 - Trasmissione telematica modello unico catastale | il testo si apre come Provvedimento, ma la scheda indica Circolare |
| #269 | 02 - Circolari | 2001 | Circ. 1188 - Riflessioni sulla normativa catastale | il nome indica il n. 1188, l'intestazione il n. 11 |
| #277 | 02 - Circolari | 2001 | Circ. 23 - Aggiornamento geometrico del catasto | il testo si apre come Provvedimento, ma la scheda indica Circolare; anno 2001 registrato, ma il testo cita il 2006 |
| #334 | 02 - Circolari | 1995 | Circ. 194 - Accettazione tipo mappale con stralcio di corte | anno 1995 registrato, ma il testo cita il 2006 |
| #336 | 02 - Circolari | 1994 | Circ. 1898 - Classamento discariche rifiuti solidi urbani | anno 1994 registrato, ma il testo cita il 2006 |
| #340 | 02 - Circolari | 1993 | Circ. 2 - Attivazione procedure Pregeo 7.00 | anno 1993 registrato, ma il testo cita il 1998 |
| #341 | 02 - Circolari | 1993 | Circ. 212 - Cancellazione annotazione ruralità immobili abit | anno 1993 registrato, ma il testo cita il 2012 |
| #355 | 02 - Circolari | 1991 | Circ. 4 - Revisione catasto edilizio urbano | anno 1991 registrato, ma il testo cita il 1995 |
| #376 | 02 - Circolari | 1988 | Circ. 112 - Attribuzione rendita catastale immobili | il testo si apre come Legge n. 70, ma la scheda indica Circolare; anno 1988 registrato, ma il testo cita il 1997 |
| #377 | 02 - Circolari | 1988 | Circ. 11 - Disposizioni integrative sulla normativa catastal | anno 1988 registrato, ma il testo cita il 1998 |
| #391 | 02 - Circolari | 1985 | Circ. 2 - Integrazioni procedurali per adempimenti catastali | il nome indica il n. 2, l'intestazione il n. 15 |
| #399 | 02 - Circolari | 1975 | Circ. 3 - Iscrizione aree scoperte in catasto | il testo si apre come D.P.R. n. 650, ma la scheda indica Circolare |
| #401 | 02 - Circolari | 1973 | Circ. 3 - Estinzione anticipata del finanziamento ipotecario | anno 1973 registrato, ma il testo cita il 2001 |
| #402 | 02 - Circolari | 1973 | Circ. 8 - Applicazione art 15 del D.P.R. 601 | anno 1973 registrato, ma il testo cita il 2002 |
| #407 | 02 - Circolari | 1972 | Circ. 30 - Estensione servizio trasmissione telematica catas | il testo si apre come Provvedimento, ma la scheda indica Circolare; anno 1972 registrato, ma il testo cita il 2007 |
| #408 | 02 - Circolari | 1972 | Circ. 14 - Estensione servizio trasmissione telematica catas | il testo si apre come Provvedimento, ma la scheda indica Circolare; anno 1972 registrato, ma il testo cita il 2008 |
| #410 | 02 - Circolari | 1969 | Circ. 51597 - Procedura Pregeo per aggiornamento geometrico  | il testo si apre come Provvedimento, ma la scheda indica Circolare; anno 1969 registrato, ma il testo cita il 2009 |
| #413 | 02 - Circolari | 1942 | Circ. 60 - Quadro generale delle categorie catastali | il testo si apre come Legge, ma la scheda indica Circolare |
| #414 | 02 - Circolari | 1941 | Circ. 134 - Quadro generale delle categorie catastali | il testo si apre come Legge, ma la scheda indica Circolare |
| #415 | 02 - Circolari | 1939 | Formazione delle mappe catastali | anno 1939 registrato, ma il testo cita il 1970 |
| #422 | 03 - Comunicati stampa | 2015 | Com. 73489 - Non c'è testo da elaborare | titolo inservibile («Com. 73489 - Non c'è testo da elaborare») senza un'alternativa affidabile |
| #436 | 03 - Comunicati stampa | 2012 | Com. 5 - Classamento immobili di interesse culturale | il testo si apre come Circolare n. 5, ma la scheda indica Comunicato stampa |
| #437 | 03 - Comunicati stampa | 2012 | Com. 6 - Determinazione rendita catastale immobili speciali | il testo si apre come Circolare n. 6/2012, ma la scheda indica Comunicato stampa |
| #444 | 03 - Comunicati stampa | 2012 | Com. 4 - Novità sulla consultazione banche dati catastale | il testo si apre come Circolare n. 4, ma la scheda indica Comunicato stampa |
| #445 | 03 - Comunicati stampa | 2012 | Com. 3 - Accettazione tacita dell'eredità e sanzioni | il testo si apre come Circolare n. 3, ma la scheda indica Comunicato stampa |
| #446 | 03 - Comunicati stampa | 2012 | Modalità tecniche per dichiarazioni colturali | il testo si apre come Provvedimento, ma la scheda indica Comunicato stampa |
| #448 | 03 - Comunicati stampa | 2011 | Com. 7 - Aggiornamento banche dati catastali immobili fantas | il testo si apre come Circolare n. 7/2011, ma la scheda indica Comunicato stampa |
| #456 | 03 - Comunicati stampa | 2008 | Fruizione dati conservatorie da parte dei Comuni | il testo si apre come Provvedimento, ma la scheda indica Comunicato stampa |
| #459 | 03 - Comunicati stampa | 2007 | Com. 3 - Estensione procedure telematiche catastali | il testo si apre come Circolare n. 3, ma la scheda indica Comunicato stampa |
| #462 | 03 - Comunicati stampa | 2006 | Com. 4090 - Accatastamento unità immobiliari urbane | il testo si apre come Circolare n. 3/2006, ma la scheda indica Comunicato stampa |
| #539 | 05 - Corsi e Indicazio | 2003 | Corso 49 T - Aggiornamento dei tipi catastali | il testo si apre come Circolare n. 49/T, ma la scheda indica Materiale didattico |
| #553 | 05 - Corsi e Indicazio | 1988 | Corso 2 - Aggiornamento cartografico catastale numerico | il testo si apre come Circolare n. 2/1988, ma la scheda indica Materiale didattico |
| #573 | 05 - Corsi e Indicazio | s.d. | Corso | titolo inservibile («Corso») senza un'alternativa affidabile |
| #575 | 05 - Corsi e Indicazio | s.d. | Non è possibile estrarre informazioni utili dal testo fornit | titolo inservibile («Non è possibile estrarre informazioni utili dal testo fornit») senza un'alternativa affidabile |
| #576 | 05 - Corsi e Indicazio | s.d. | Corso | titolo inservibile («Corso») senza un'alternativa affidabile |
| #582 | 05 - Corsi e Indicazio | s.d. | Non è possibile estrarre un oggetto significativo da questo  | titolo inservibile («Non è possibile estrarre un oggetto significativo da questo ») senza un'alternativa affidabile |
| #583 | 05 - Corsi e Indicazio | s.d. | Non è possibile estrarre un oggetto significativo da questo  | titolo inservibile («Non è possibile estrarre un oggetto significativo da questo ») senza un'alternativa affidabile |
| #622 | 06 - Decreti Legge | 2001 | Lottizzazione abusiva di terreni edificatori | anno 2001 registrato, ma il testo cita il 2005 |
| #637 | 06 - Decreti Legge | 1993 | Istituzione del catasto dei fabbricati | anno 1993 registrato, ma il testo cita il 1999 |
| #638 | 06 - Decreti Legge | 1993 | Razionalizzazione dei criteri di determinazione dei redditi | anno 1993 registrato, ma il testo cita il 1998 |
| #639 | 06 - Decreti Legge | 1993 | Istituzione del catasto dei fabbricati | anno 1993 registrato, ma il testo cita il 1999 |
| #640 | 06 - Decreti Legge | 1992 | Aliquote imposte di registro per atti immobiliari | anno 1992 registrato, ma il testo cita il 1999 |
| #647 | 06 - Decreti Legge | 1972 | Caratteristiche abitazioni di lusso | anno 1972 registrato, ma il testo cita il 2000 |
| #651 | 06 - Decreti Legge | 1969 | Revisione criteri accatastamento fabbricati rurali | anno 1969 registrato, ma il testo cita il 1998 |
| #654 | 06 - Decreti Legge | 1939 | Commissioni censuarie e catasto terreni | anno 1939 registrato, ma il testo cita il 1943 |
| #658 | 06 - Decreti Legge | 1938 | Semplificazione procedura catasto | anno 1938 registrato, ma il testo cita il 1977 |
| #666 | 06 - Decreti Legge | 1904 | Opere idrauliche delle acque pubbliche | anno 1904 registrato, ma il testo cita il 1937 |
| #675 | 07 - Demanio | 2002 | Individuazione beni immobili di proprietà statale | il testo si apre come Decreto, ma la scheda indica Documento demaniale |
| #676 | 07 - Demanio | 2002 | Individuazione beni immobili di proprietà statale | il testo si apre come Decreto, ma la scheda indica Documento demaniale |
| #677 | 07 - Demanio | 2002 | Individuazione beni immobili di proprietà statale | il testo si apre come Decreto, ma la scheda indica Documento demaniale |
| #686 | 08 - Determinazioni | 1990 | Det. 27 - Revisione procedimenti amministrativi dell'Agenzia | anno 1990 registrato, ma il testo cita il 2004 |
| #705 | 09 - Direttive | 2008 | Dir. 2025 - Modifica servizio accettazione Punti Fiduciali | anno 2008 registrato, ma il testo cita il 2025 |
| #706 | 09 - Direttive | 2007 | Dir. 49 - Accertamento del reddito complessivo netto | il testo si apre come Circolare n. 49/E, ma la scheda indica Direttiva |
| #711 | 09 - Direttive | 2007 | Dir. 3134 - Unificazione particelle divise in porzioni | il testo si apre come Circolare n. 1, ma la scheda indica Direttiva |
| #721 | 09 - Direttive | 2001 | Dir. 02 - Presentazione unità immobiliari con destinazione s | anno 2001 registrato, ma il testo è datato 2 dicembre 2002 |
| #844 | 11 - Istruzioni | 2004 | Detrazione per gli inquilini | anno 2004 registrato, ma il testo cita il 2014 |
| #861 | 11 - Istruzioni | 2001 | Istr. 9 - Variazione di destinazione immobiliare | il testo si apre come Circolare n. 9, ma la scheda indica Istruzione |
| #863 | 11 - Istruzioni | 2001 | Istr. 9 - Modifica di identificativo catastale | il testo si apre come Circolare n. 9, ma la scheda indica Istruzione |
| #867 | 11 - Istruzioni | 2001 | Istr. 9 - Frazionamento per trasferimento di diritti | il testo si apre come Circolare n. 9, ma la scheda indica Istruzione |
| #872 | 11 - Istruzioni | 2001 | Istr. 9 - Demolizione totale con costituzione area urbana | il testo si apre come Circolare n. 9, ma la scheda indica Istruzione |
| #874 | 11 - Istruzioni | 2001 | Istr. 9 - Variazione distribuzione spazi interni immobiliari | il testo si apre come Circolare n. 9, ma la scheda indica Istruzione |
| #881 | 11 - Istruzioni | 2000 | Istr. 9 - Costruzione di unità immobiliari multiple | il testo si apre come Circolare n. 9/2000, ma la scheda indica Istruzione |
| #882 | 11 - Istruzioni | 1998 | Contenuti della cartografia catastale | anno 1998 registrato, ma il testo cita il 2003 |
| #884 | 11 - Istruzioni | 1998 | Revisione classamento immobili urbani privati | anno 1998 registrato, ma il testo cita il 2013 |
| #885 | 11 - Istruzioni | 1997 | Causali di rifiuto pratiche Docfa | anno 1997 registrato, ma il testo cita il 2010 |
| #887 | 11 - Istruzioni | 1992 | Imposte su immobili ereditati e donati | anno 1992 registrato, ma il testo cita il 2014 |
| #890 | 11 - Istruzioni | 1970 | Stazione di servizio con fabbricati | anno 1970 registrato, ma il testo cita il 2018 |
| #905 | 11 - Istruzioni | 1949 | Conservazione del nuovo catasto terreni | il testo si apre come Decreto, ma la scheda indica Istruzione |
| #907 | 11 - Istruzioni | 1943 | Lettura della carta topografica | anno 1943 registrato, ma il testo cita il 2011 |
| #910 | 11 - Istruzioni | 1942 | Rappresentazione cartografica dei fabbricati | anno 1942 registrato, ma il testo cita il 2010 |
| #914 | 11 - Istruzioni | 1931 | Rappresentazione cartografica delle acque | anno 1931 registrato, ma il testo cita il 1960 |
| #929 | 12 - Leggi | 2010 | Mediazione per controversie civili e commerciali | il testo si apre come Decreto legislativo n. 28, ma la scheda indica Legge |
| #930 | 12 - Leggi | 2005 | Legge 25 - Non è possibile estrarre un oggetto significativo | titolo inservibile («Legge 25 - Non è possibile estrarre un oggetto significativo») senza un'alternativa affidabile |
| #935 | 12 - Leggi | 1996 | Legge 662 - Misure di razionalizzazione della finanza pubbli | anno 1996 registrato, ma il testo cita il 2002 |
| #939 | 12 - Leggi | 1971 | Legge 865 - Espropriazione per pubblica utilità | anno 1971 registrato, ma il testo cita il 2003 |
| #954 | 13 - Linee Guida | 2005 | Aggiornamento del valore medio di mercato | il testo si apre come Provvedimento, ma la scheda indica Linee guida |
| #1058 | 17 - Note | 2004 | Nota 64538 - Chiarimenti su Pregeo 8 a regime operativo | anno 2004 registrato, ma il testo cita il 2008 |
| #1068 | 17 - Note | 1998 | Nota 19119 - Attivazione procedura Pregeo 9 e chiarimenti op | anno 1998 registrato, ma il testo cita il 2006 |
| #1088 | 18 - Procedure Operati | 2007 | PO 16671 - Aggiornamento archivi cartografici e censuari cat | anno 2007 registrato, ma il testo è datato 28 febbraio 2008 |
| #1089 | 18 - Procedure Operati | 2007 | PO 20 - Estensione servizio trasmissione telematica catastal | il testo si apre come Provvedimento, ma la scheda indica Procedura operativa |
| #1102 | 18 - Procedure Operati | 2004 | PO 25277 - Aggiornamento catasto terreni con procedure infor | anno 2004 registrato, ma il testo è datato 21 marzo 2003 |
| #1108 | 18 - Procedure Operati | 2003 | Richiesta estratto di mappa catastale | anno 2003 registrato, ma il testo cita il 2010 |
| #1111 | 18 - Procedure Operati | 1990 | Legge 241 - Pubblicazione Gazzetta Ufficiale | anno 1990 registrato, ma il testo cita il 2004 |
| #1112 | 18 - Procedure Operati | 1969 | Riferimenti normativi catastali | anno 1969 registrato, ma il testo cita il 2010 |
| #1157 | 19 - Provvedimenti | 2006 | Procedura trasmissione dichiarazioni variazione catastale | il testo si apre come Decreto, ma la scheda indica Provvedimento |
| #1162 | 19 - Provvedimenti | 2005 | Prov. 2015 - Trasmissione telematica atti catastali | anno 2005 registrato, ma il testo cita il 2015 |
| #1172 | 19 - Provvedimenti | 1985 | Prov. 160950 - Aggiornamento importi accesso banche dati cat | anno 1985 registrato, ma il testo cita il 2014 |
| #1189 | 20 - Risoluzioni | 2009 | Ris. 20142 E - Acquisto alloggio contiguo con agevolazioni p | il nome indica il n. 20142, l'intestazione il n. 142/E |
| #1201 | 20 - Risoluzioni | 2007 | Ris. 25585 T - Variazione delle rendite catastali | il nome indica il n. 25585, l'intestazione il n. 1/2007 |
| #1219 | 21 - Sanzioni | 2000 | Sanz. 2 - Sanzioni tributarie per violazioni catastali | il testo si apre come Circolare n. 2, ma la scheda indica Sanzioni |
| #1220 | 21 - Sanzioni | 1993 | Tardivo accatastamento di fabbricati rurali | anno 1993 registrato, ma il testo cita il 2008 |
| #1250 | 22 - Sentenze | 2004 | Sent. 24 - Rideterminazione classamento e rendita catastale | anno 2004 registrato, ma il testo cita il 2013 |
| #1256 | 22 - Sentenze | 1985 | Nullità di contratto di compravendita immobile | anno 1985 registrato, ma il testo cita il 2013 |
| #1257 | 22 - Sentenze | 1968 | Ricorso contro Comune di Pavia | anno 1968 registrato, ma il testo cita il 2010 |
| #1269 | 01 - Chiarimenti | 2006 | Chiar. 24045 - Sospensione accatastamento per errore formale | il testo si apre come Nota n. 24045, ma la scheda indica Nota di chiarimento |
| #1270 | 01 - Chiarimenti | 2006 | Chiar. 4035 - Sanzioni per tardiva presentazione denunce cat | il testo si apre come Nota n. 4035, ma la scheda indica Nota di chiarimento |
| #1276 | 01 - Chiarimenti | 2006 | Chiar. 7884 - Esenzioni tributi catastali per pubblica utili | il testo si apre come Nota n. 7884, ma la scheda indica Nota di chiarimento |
| #1298 | 02 - Circolari | 2016 | Circ. 5249 - Linee guida processo tributario telematico | il nome indica il n. 5249, l'intestazione il n. 2/DF |
| #1305 | 02 - Circolari | 2013 | Circ. 61 - Aggiornamento sistema informativo demanio maritti | il nome indica il n. 61, l'intestazione il n. 6 |
| #1320 | 02 - Circolari | 2010 | Circ. 2 - Indicazioni per atti immobiliari con trascrizione | il nome indica il n. 2, l'intestazione il n. 22/2010 |
| #1329 | 02 - Circolari | 2007 | Circ. 11 - Cancellazione ipoteca iscritta a garanzia di mutu | anno 2007 registrato, ma il testo cita il 2011 |
| #1404 | 02 - Circolari | 1999 | Circ. 13 T - Definizione zone censuarie e microzone | il testo si apre come Legge n. 662, ma la scheda indica Circolare |
| #1410 | 02 - Circolari | 1997 | Circ. 112 E - Attribuzione rendita catastale immobili | il testo si apre come Legge n. 70, ma la scheda indica Circolare |
| #1418 | 02 - Circolari | 1994 | Circ. 1898 - Classamento discariche rifiuti solidi urbani | anno 1994 registrato, ma il testo cita il 2006 |
| #1431 | 02 - Circolari | 1988 | Circ. 3 - Semplificazione procedure di accatastamento immobi | il testo si apre come Legge n. 68, ma la scheda indica Circolare |
| #1432 | 02 - Circolari | 1988 | Circ. 3 - Trasferimento beni ecclesiastici | il testo si apre come Legge n. 222, ma la scheda indica Circolare |
| #1435 | 02 - Circolari | 1988 | Circ. 3 - Apertura sale visura catasto al pubblico | anno 1988 registrato, ma il testo è datato 21 febbraio 1978 |
| #1436 | 02 - Circolari | 1988 | Circ. 3 - Apertura sale visura catasto al pubblico | anno 1988 registrato, ma il testo è datato 21 febbraio 1978 |
| #1437 | 02 - Circolari | 1988 | Circ. 400558 - Valutazione automatica degli immobili urbani | il testo si apre come Legge n. 70, ma la scheda indica Circolare |
| #1441 | 02 - Circolari | 1987 | Circ. 300012 - Imposta di successione e donazione revisione  | il testo si apre come Legge n. 880, ma la scheda indica Circolare |
| #1448 | 02 - Circolari | 1986 | Circ. 13805 - Chiarimenti sulla pubblicità immobiliare | il testo si apre come Legge n. 52, ma la scheda indica Circolare |
| #1449 | 02 - Circolari | 1986 | Circ. 37 - Testo unico imposta di registro | il testo si apre come D.P.R. n. 131, ma la scheda indica Circolare |
| #1461 | 02 - Circolari | 1985 | Circ. 3 - Intestazioni catastali di immobili espropriati | il nome indica il n. 3, l'intestazione il n. 5/1985 |
| #1462 | 02 - Circolari | 1985 | Circ. 3 - Intestazioni catastali e voltura immobiliare | il nome indica il n. 3, l'intestazione il n. 5/1985 |
| #1464 | 02 - Circolari | 1985 | Circ. 3 - Adempimenti per legge 28 febbraio 1985 numero 47 | il nome indica il n. 3, l'intestazione il n. 5/1985 |
| #1465 | 02 - Circolari | 1985 | Circ. 3 - Adempimenti per legge 28 febbraio 1985 numero 47 | il nome indica il n. 3, l'intestazione il n. 5/1985 |
| #1467 | 02 - Circolari | 1985 | Circ. 3 - Identificativi catastali immobiliari | il testo si apre come Legge n. 52, ma la scheda indica Circolare |
| #1471 | 02 - Circolari | 1985 | Circ. 9095 - Modifiche alla pubblicità immobiliare | il testo si apre come Legge n. 52, ma la scheda indica Circolare |
| #1481 | 02 - Circolari | 1982 | Circ. 86127 - Disciplina locazioni immobili urbani | il testo si apre come Legge n. 94, ma la scheda indica Circolare |
| #1491 | 02 - Circolari | 1975 | Iscrizione aree scoperte in catasto | il testo si apre come D.P.R. n. 650, ma la scheda indica Circolare |
| #1494 | 02 - Circolari | 1969 | Circ. 9 - Frazionamento di terreni agrari | anno 1969 registrato, ma il testo cita il 2000 |
| #1501 | 02 - Circolari | 1941 | Circ. 134 - Quadro generale delle categorie catastali | il testo si apre come Legge, ma la scheda indica Circolare |
| #1577 | 06 - Decreti Legge | 2001 | Definizioni degli interventi edilizi | anno 2001 registrato, ma il testo cita il 2013 |
| #1591 | 06 - Decreti Legge | 1993 | DL 345 - Revisione tariffe estimo immobili | anno 1993 registrato, ma il testo cita il 2003 |
| #1597 | 06 - Decreti Legge | 1991 | Decr. 18 - Revisione classamento unita' immobiliari urbane | anno 1991 registrato, ma il testo cita il 1995 |
| #1599 | 06 - Decreti Legge | 1991 | Accesso informatico al catasto terreni e urbano | anno 1991 registrato, ma il testo cita il 1997 |
| #1614 | 06 - Decreti Legge | 1986 | Riscossione imposte dirette e termini tributari | anno 1986 registrato, ma il testo cita il 1990 |
| #1615 | 06 - Decreti Legge | 1986 | Aliquote imposte di registro per atti immobiliari | anno 1986 registrato, ma il testo cita il 1999 |
| #1617 | 06 - Decreti Legge | 1986 | Imposta sul reddito delle persone fisiche | anno 1986 registrato, ma il testo cita il 1997 |
| #1637 | 06 - Decreti Legge | 1945 | Decr. 1441 - Regolamento servizio uffici provinciali catasto | anno 1945 registrato, ma il testo cita il 2007 |
| #1664 | 08 - Determinazioni | 2005 | Det. 9 - Modalità di messa a disposizione dei dati | il testo si apre come Provvedimento, ma la scheda indica Determinazione |
| #1666 | 08 - Determinazioni | 2005 | Det. 16 - Aggiornamento del valore medio di mercato catastal | il testo si apre come Provvedimento, ma la scheda indica Determinazione |
| #1697 | 11 - Istruzioni | 1948 | Conservazione del Catasto edilizio urbano | anno 1948 registrato, ma il testo cita il 1961 |
| #1701 | 11 - Istruzioni | 1942 | Rappresentazione cartografica dei fabbricati | anno 1942 registrato, ma il testo cita il 2010 |
| #1720 | 12 - Leggi | 1989 | Legge 427 - Aggiornamento catasto edilizio urbano e terreni | anno 1989 registrato, ma il testo cita il 1995 |
| #1722 | 12 - Leggi | 1988 | Legge 67 - Finanziamento progetti miglioramento servizi e pr | anno 1988 registrato, ma il testo cita il 1993 |
| #1725 | 12 - Leggi | 1985 | Legge 222 - Riconoscimento civile dei decreti canonici eccle | anno 1985 registrato, ma il testo cita il 1989 |
| #1728 | 12 - Leggi | 1985 | Legge 47 - Iscrizioni al catasto edilizio urbano | anno 1985 registrato, ma il testo cita il 2002 |
| #1734 | 12 - Leggi | 1978 | Legge 457 - Norme per l'edilizia residenziale pubblica | anno 1978 registrato, ma il testo cita il 2002 |
| #1735 | 12 - Leggi | 1978 | Legge 397 - Categorie catastali degli immobili urbani | anno 1978 registrato, ma il testo cita il 1998 |
| #1736 | 12 - Leggi | 1971 | Legge 865 - Espropriazione per pubblica utilità | anno 1971 registrato, ma il testo cita il 2003 |
| #1740 | 12 - Leggi | 1960 | Legge 131 - Calcolo reddito imponibile unita' immobiliari ur | anno 1960 registrato, ma il testo cita il 1999 |
| #1743 | 12 - Leggi | 1904 | Legge 523 - Opere idrauliche delle acque pubbliche | anno 1904 registrato, ma il testo cita il 1937 |
| #1756 | 16 - Modulistica | 1986 | Modelli per nota di trascrizione e iscrizione | il testo si apre come Decreto, ma la scheda indica Modulistica |
| #1760 | 17 - Note | 2024 | Razionalizzazione tributi indiretti diversi dall'IVA | il testo si apre come Decreto legislativo n. 139, ma la scheda indica Nota |
| #1786 | 17 - Note | 2017 | Nota 79 E - Istituzione codici tributo per versamento somme | il testo si apre come Risoluzione n. 79/E, ma la scheda indica Nota |
| #1796 | 17 - Note | 2016 | Erogazione servizi consultazione catastale telematica | anno 2016 registrato, ma il testo cita il 2024 |
| #1802 | 17 - Note | 2015 | Nota 3 - Riordino delle commissioni censuarie provinciali | il testo si apre come Circolare n. 3/E, ma la scheda indica Nota |
| #1811 | 17 - Note | 2015 | Sistema Informativo Catastale | anno 2015 registrato, ma il testo cita il 2019 |
| #1812 | 17 - Note | 2014 | Nota 2 - Modifiche alla tassazione immobiliare | il testo si apre come Circolare n. 2/E, ma la scheda indica Nota |
| #1814 | 17 - Note | 2014 | Nota 8089 - Prevenzione della corruzione e dell'illegalità | anno 2014 registrato, ma il testo cita il 2018 |
| #1817 | 17 - Note | 2014 | Trasmissione telematica del titolo immobiliare | il testo si apre come Provvedimento, ma la scheda indica Nota |
| #1818 | 17 - Note | 2013 | Modifica del saggio di interesse legale | il testo si apre come Decreto, ma la scheda indica Nota |
| #1825 | 17 - Note | 2012 | Parametri compensi professioni vigilate | il testo si apre come Decreto ministeriale n. 140, ma la scheda indica Nota |
| #1835 | 17 - Note | 2010 | Nota 3 - Individuazione catastale dei beni condominiali | il nome indica il n. 3, l'intestazione il n. 5892 |
| #1837 | 17 - Note | 2010 | Stabilizzazione finanziaria e competitività economica | il testo si apre come Decreto-legge n. 78, ma la scheda indica Nota |
| #1846 | 17 - Note | 2009 | Nota 35890 - Acque esenti da estimo strade pubbliche | anno 2009 registrato, ma il testo è datato 7 luglio 2010 |
| #1853 | 17 - Note | 2007 | Nota 9 - Trasferimento sede corso psicoterapia | il testo si apre come Provvedimento, ma la scheda indica Nota |
| #1854 | 17 - Note | 2007 | Nota 6 - Azioni di salvaguardia e prevenzione | il nome indica il n. 6, l'intestazione il n. 42577 |
| #1872 | 17 - Note | 2000 | Semplificazione adempimenti tributari immobiliari | il testo si apre come Decreto legislativo n. 9, ma la scheda indica Nota |
| #1875 | 17 - Note | 1997 | Nota 10 - Modifica sanzioni catasto e pubblicità immobiliare | anno 1997 registrato, ma il testo cita il 2008 |
| #1880 | 17 - Note | 1995 | Elaborazione dei servizi di pubblicità immobiliare | il testo si apre come Decreto, ma la scheda indica Nota |
| #1884 | 17 - Note | 1992 | Norme sul processo tributario | il testo si apre come Decreto legislativo n. 546, ma la scheda indica Nota |
| #1887 | 17 - Note | 1988 | Coefficienti di aggiornamento dei redditi catastali | il testo si apre come Decreto, ma la scheda indica Nota |
| #1889 | 17 - Note | 1988 | Notificazione atti catastali per via postale | il testo si apre come Decreto, ma la scheda indica Nota |
| #1890 | 17 - Note | 1987 | Coefficienti di aggiornamento dei redditi catastali | il testo si apre come Decreto, ma la scheda indica Nota |
| #1891 | 17 - Note | 1980 | Aggiornamento redditi catastali terreni biennio 1980-81 | il testo si apre come Decreto, ma la scheda indica Nota |
| #1892 | 17 - Note | 1980 | Deduzioni fuori tariffa per redditi terreni | il testo si apre come Decreto, ma la scheda indica Nota |
| #1893 | 17 - Note | 1979 | Revisione estimi dei terreni agrari | il testo si apre come Decreto, ma la scheda indica Nota |
| #1895 | 17 - Note | 1969 | Caratteristiche abitazioni di lusso | il testo si apre come Decreto ministeriale n. 1072, ma la scheda indica Nota; anno 1969 registrato, ma il testo cita il 2000 |
| #1898 | 17 - Note | 1939 | Violazione norme tributarie catastali immobiliari | anno 1939 registrato, ma il testo cita il 1997 |
| #1901 | 17 - Note | 1917 | Modifiche al servizio di voltura catastale online | anno 1917 registrato, ma il testo cita il 2026 |
| #2455 | 00 - Sito Ade | 2005 | Dlgs 7 marzo 2005 n82_dlgs_82_2005 | anno 2005 registrato, ma il testo cita il 2010 |
| #2466 | 00 - Sito Ade | 2005 | Articolo 65 del Decreto legislativo n82 marzo2005_art_65_dlg | anno 2005 registrato, ma il testo cita il 2012 |
| #2480 | 00 - Sito Ade | 2010 | Circolare 2010 n. 2 - DL n. 78-2010 art. 19 comma 14 | il nome indica il n. 2, l'intestazione il n. 22/2010 |
| #2503 | 00 - Sito Ade | 1993 | 40_bis_dlgs_385_1993 | anno 1993 registrato, ma il testo cita il 2012 |
| #2504 | 00 - Sito Ade | 1993 | 7_quinquies_dlgs_385_1993 | anno 1993 registrato, ma il testo cita il 2012 |
| #2511 | 00 - Sito Ade | 1972 | Decreto del Presidente della Repubblica del 26_10_1972 n. 65 | anno 1972 registrato, ma il testo cita il 2009 |
| #2513 | 00 - Sito Ade | 1993 | Decreto-legge del 23_01_1993 n. 16 - | anno 1993 registrato, ma il testo cita il 2003 |
| #2539 | 00 - Sito Ade | 2006 | Articolo 2 comma 36 DL n262 03102006_art_2_dl_262_2006 | anno 2006 registrato, ma il testo cita il 2013 |
| #2542 | 00 - Sito Ade | 1992 | Dlgs n546 31121992_decreto_legislativo_1992_546 | anno 1992 registrato, ma il testo cita il 2008 |
| #2547 | 00 - Sito Ade | 1993 | Articolo 9 Dl 30121993 n557_art_9_dl_557_1993 | anno 1993 registrato, ma il testo cita il 2008 |
| #2564 | 00 - Sito Ade | 2001 | Articolo 1 comma 2 del Decreto legislativo 30032001 n 165_ar | anno 2001 registrato, ma il testo cita il 2011 |
| #2565 | 00 - Sito Ade | 1999 | Articolo 64 DL 300 30071999_D_Lgs_300_ 1999_art_64 | il testo si apre come Decreto legislativo n. 300, ma la scheda indica Articolo di legge; anno 1999 registrato, ma il testo cita il 2012 |
| #2566 | 00 - Sito Ade | 2006 | Decreto legge 262 03102006 comma 33 articolo 2_decreto262_03 | anno 2006 registrato, ma il testo cita il 2013 |
| #2567 | 00 - Sito Ade | 1992 | Decreto legislativo 546 31121992_decreto legislativo 546_199 | anno 1992 registrato, ma il testo cita il 2008 |
| #2578 | 00 - Sito Ade | 1972 | Articolo 4 del DPR 26 ottobre 1972, n. 650 | anno 1972 registrato, ma il testo cita il 1996 |
| #2584 | 00 - Sito Ade | 1997 | Dl 472 18121997 - art13_19971218_DecretoLegislativo_472_Art. | anno 1997 registrato, ma il testo cita il 2011 |
