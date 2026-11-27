/**
 * Backfill UNA TANTUM degli archivi storici dell'Agenzia delle Entrate e
 * dell'ex Agenzia del Territorio, dal proprio PC e a costo zero.
 *
 * Percorre gli indici d'archivio (anni -> mesi -> atti, tutto HTML lato
 * server, senza browser), e per ogni atto mai visto applica la STESSA pipeline
 * del cron del lunedi': pertinenza catastale sul titolo e sul testo del PDF,
 * protocollo, deduplica rigorosa sul corpus (estremi, URL, oggetto) e sul
 * registro, titolo dall'oggetto ufficiale (NESSUNA chiamata AI), metadati
 * normalizzati. Idempotente: gli atti gia' visti (anche scartati) si saltano,
 * quindi si puo' interrompere e rilanciare. Una richiesta al secondo.
 * L'indicizzazione semantica dei nuovi atti la fa il cron giornaliero, entro
 * il budget gratuito di neuroni.
 *
 * Uso (TURSO_DATABASE_URL e TURSO_AUTH_TOKEN da .env.local, token che scrive):
 *   npm run importa:storico-ade -- --prova                  (nessuna scrittura)
 *   npm run importa:storico-ade -- --fonte territorio-circolari
 *   npm run importa:storico-ade -- --da 2010 --a 2015 --limite 50
 * Fonti: circolari, risoluzioni, provvedimenti, territorio-circolari,
 * territorio-risoluzioni (default: tutte).
 */
import "./env-locale";

const args = process.argv.slice(2);
const valore = (nome: string) => {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : undefined;
};
const prova = args.includes("--prova");
const limite = Number(valore("--limite")) || Infinity;
const da = Number(valore("--da")) || 0;
const a = Number(valore("--a")) || 9999;
const soloFonte = valore("--fonte");
const PAUSA_MS = 1000;

const pausa = () => new Promise((ok) => setTimeout(ok, PAUSA_MS));

async function main() {
  const { ARCHIVI_ADE, linkAnni, linkMesi, vociPagina } = await import("../lib/aggiornamenti/storico");
  const { scaricaElenco } = await import("../lib/aggiornamenti/fonti");
  const { valutaMetadati, valutaTesto } = await import("../lib/aggiornamenti/pertinenza");
  const { scaricaPdf, estraiTesto, estraiProtocollo } = await import("../lib/aggiornamenti/pdf");
  const { assicuraSchema, cercaDuplicato, inserisciDocumento, registraVoce, vociNote } = await import("../lib/aggiornamenti/archivio");
  const { chiaveAtto, oggettoDiRipiego } = await import("../lib/aggiornamenti/esegui");
  const { eseguiBonifica } = await import("../lib/metadati/bonifica");
  const { getDb } = await import("../lib/db");
  const db = getDb();
  if (!prova) await assicuraSchema(db);

  const archivi = ARCHIVI_ADE.filter((x) => !soloFonte || x.id === soloFonte);
  if (!archivi.length) throw new Error(`fonte sconosciuta: ${soloFonte} (disponibili: ${ARCHIVI_ADE.map((x) => x.id).join(", ")})`);
  const totale = { pagine: 0, voci: 0, nuove: 0, importati: 0, duplicati: 0, scartati: 0, errori: 0 };
  const nuoviId: number[] = [];

  const leggi = async (url: string) => {
    await pausa();
    totale.pagine++;
    const r = await scaricaElenco(url);
    if (!r.ok) console.log(`  ! ${url}: ${r.errore}`);
    return r.ok ? r.html : "";
  };

  for (const arch of archivi) {
    console.log(`\n# ${arch.nome}`);
    const indice = await leggi(arch.indice);
    let voci = arch.diretto ? vociPagina(indice, arch.fonte) : [];
    if (!arch.diretto) {
      for (const anno of linkAnni(indice).filter((x) => x.anno >= da && x.anno <= a)) {
        const html = await leggi(anno.url);
        const mesi = linkMesi(html);
        const dellAnno = [...vociPagina(html, arch.fonte)];
        for (const mese of mesi) dellAnno.push(...vociPagina(await leggi(mese.url), arch.fonte));
        console.log(`  ${anno.anno}: ${mesi.length} pagine mensili, ${dellAnno.length} atti`);
        voci.push(...dellAnno);
      }
    }
    voci = [...new Map(voci.map((v) => [v.url, v])).values()].filter((v) => !v.anno || (v.anno >= da && v.anno <= a));
    totale.voci += voci.length;
    const note = prova ? new Map() : await vociNote(db, voci.map((v) => v.url));
    const nuove = voci.filter((v) => !note.has(v.url));
    totale.nuove += nuove.length;
    console.log(`  ${voci.length} atti in archivio, ${nuove.length} mai visti`);

    for (const v of nuove) {
      if (totale.importati >= limite) break;
      const base = { url: v.url, fonte: arch.fonte.id, titoloFonte: v.titoloFonte, oggetto: v.oggetto };
      const meta = valutaMetadati(v.titoloFonte, v.oggetto);
      if (!meta.scarica) {
        totale.scartati++;
        if (!prova) await registraVoce(db, { ...base, tipo: v.tipo, numero: v.numero, data: v.data, anno: v.anno, chiave: chiaveAtto(v.tipo, v.numero, v.anno, v.data), stato: "non_pertinente", motivo: "oggetto non pertinente al catasto (archivio storico)", punteggio: 0 });
        continue;
      }
      try {
        await pausa();
        const estratto = await estraiTesto(await scaricaPdf(v.urlDownload));
        const valutazione = valutaTesto(estratto.testo, meta);
        let numero = v.numero;
        let anno = v.anno;
        if (v.tipo === "provvedimento") {
          const prot = estraiProtocollo(estratto.testo);
          if (prot) {
            numero = prot.numero;
            anno = anno ?? prot.anno;
          }
        }
        anno = anno ?? (Number(v.data?.slice(0, 4)) || new Date().getUTCFullYear());
        const chiave = chiaveAtto(v.tipo, numero, anno, v.data);
        if (!valutazione.pertinente) {
          totale.scartati++;
          if (!prova) await registraVoce(db, { ...base, tipo: v.tipo, numero, data: v.data, anno, chiave, stato: "non_pertinente", motivo: valutazione.motivo, punteggio: valutazione.punteggio, sha256: estratto.sha256 });
          continue;
        }
        const duplicato = await cercaDuplicato(db, v.tipo, numero, anno, v.url, v.oggetto);
        if (duplicato) {
          totale.duplicati++;
          if (!prova) await registraVoce(db, { ...base, tipo: v.tipo, numero, data: v.data, anno, chiave, stato: "duplicato", motivo: `già presente nel corpus (documento #${duplicato})`, docId: duplicato, sha256: estratto.sha256 });
          continue;
        }
        const dataBreve = v.data ? v.data.split("-").reverse().join("/") : null;
        const ogg = oggettoDiRipiego(v.oggetto || v.titoloFonte);
        const titolo = numero ? `${arch.fonte.abbrev} ${numero} - ${ogg}` : dataBreve ? `${arch.fonte.abbrev} del ${dataBreve} - ${ogg}` : `${arch.fonte.abbrev} - ${ogg}`;
        if (prova) {
          totale.importati++;
          console.log(`  + da importare: ${titolo} (${anno})`);
          continue;
        }
        const docId = await inserisciDocumento(db, { cartella: arch.fonte.cartella, nomeFile: v.url, titolo, anno, testo: estratto.testo, tipo: v.tipo, numero, data: v.data, sha256: estratto.sha256 });
        await registraVoce(db, { ...base, tipo: v.tipo, numero, data: v.data, anno, chiave, stato: "importato", motivo: `archivio storico: ${valutazione.motivo}`, punteggio: valutazione.punteggio, docId, sha256: estratto.sha256, titolo, cartella: arch.fonte.cartella, testo: estratto.testo });
        totale.importati++;
        nuoviId.push(docId);
        console.log(`  + #${docId} ${titolo} (${anno})`);
      } catch (err) {
        totale.errori++;
        const motivo = (err as Error).message.slice(0, 200);
        console.log(`  ! ${v.titoloFonte}: ${motivo}`);
        if (!prova) await registraVoce(db, { ...base, tipo: v.tipo, numero: v.numero, data: v.data, anno: v.anno, chiave: chiaveAtto(v.tipo, v.numero, v.anno, v.data), stato: "errore", motivo, incrementaTentativi: true }).catch(() => undefined);
      }
    }
  }

  if (nuoviId.length) {
    const b = await eseguiBonifica(db, { applica: true, ids: nuoviId });
    console.log(`\nMetadati normalizzati per ${b.esaminati} nuovi atti (${b.duplicati} doppioni esatti esclusi).`);
  }
  console.log(`\n${prova ? "PROVA A SECCO — " : ""}${totale.pagine} pagine lette, ${totale.voci} atti in archivio, ${totale.nuove} mai visti: ${totale.importati} ${prova ? "da importare" : "importati"}, ${totale.duplicati} già nel corpus, ${totale.scartati} non pertinenti, ${totale.errori} errori.`);
  if (!prova && nuoviId.length) console.log("L'indicizzazione semantica dei nuovi atti parte con il cron giornaliero (03:17 UTC), entro il budget gratuito di neuroni.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
