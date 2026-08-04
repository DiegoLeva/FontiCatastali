/**
 * Precalcola la mappa degli argomenti e la scrive in `lib/topics-index.json`.
 *
 * Gira PRIMA di `next build` (script `prebuild` in package.json), quando le
 * credenziali Turso sono gia' disponibili. Cosi' il corpus si scarica e si
 * classifica una volta per deploy, invece che a ogni avvio a freddo della
 * funzione serverless.
 *
 * Se le credenziali mancano — sviluppo locale, fork senza segreti — scrive un
 * indice vuoto e l'applicazione ripiega sulla classificazione a runtime. Il
 * build non deve mai fallire per questo.
 */
import { createClient } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";
import {
  INCIPIT_BUILD,
  fmtAnno,
  nodiDelDocumento,
  testoDaClassificare,
  type DocTuple,
  type IndicePrecalcolato,
} from "../lib/classify";
import { NODO_RESIDUO } from "../lib/taxonomy";

const USCITA = path.join(process.cwd(), "lib", "topics-index.json");

const VUOTO: IndicePrecalcolato = {
  generato: false,
  creatoIl: "",
  totale: 0,
  classificati: 0,
  docs: [],
  nodi: {},
};

const SQL = `
  SELECT id, cartella_origine AS cartella, nuovo_nome_file AS nomeFile,
         titolo, anno, tema,
         substr(testo_estratto, 1, ${INCIPIT_BUILD}) AS incipit
  FROM documenti;
`;

function scrivi(indice: IndicePrecalcolato): void {
  fs.writeFileSync(USCITA, JSON.stringify(indice) + "\n", "utf8");
}

async function main(): Promise<void> {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    console.warn(
      "[build-topics] TURSO_DATABASE_URL assente: indice vuoto, " +
        "la mappa classifichera' a runtime."
    );
    scrivi(VUOTO);
    return;
  }

  const t0 = Date.now();
  const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  const rs = await db.execute(SQL);

  const docs: DocTuple[] = [];
  const nodi = new Map<string, number[]>();
  let classificati = 0;

  rs.rows.forEach((row, i) => {
    const cartella = String(row.cartella ?? "");
    const nomeFile = String(row.nomeFile ?? "");
    const titolo = String(row.titolo ?? "");
    docs.push([
      Number(row.id),
      cartella,
      nomeFile,
      titolo,
      fmtAnno(row.anno),
    ]);

    const trovati = nodiDelDocumento(
      testoDaClassificare({
        cartella,
        nomeFile,
        titolo,
        tema: String(row.tema ?? ""),
        incipit: String(row.incipit ?? ""),
      })
    );

    if (trovati.size > 0) classificati++;
    const destinazioni = trovati.size === 0 ? [NODO_RESIDUO] : [...trovati];
    for (const id of destinazioni) {
      const lista = nodi.get(id);
      if (lista) lista.push(i);
      else nodi.set(id, [i]);
    }
  });

  // Piu' recenti in cima, a parita' d'anno in ordine di titolo: l'ordinamento
  // si paga qui una volta, non a ogni richiesta.
  for (const lista of nodi.values()) {
    lista.sort((a, b) => {
      const [, , , ta, aa] = docs[a];
      const [, , , tb, ab] = docs[b];
      return ab.localeCompare(aa) || ta.localeCompare(tb);
    });
  }

  scrivi({
    generato: true,
    creatoIl: new Date().toISOString(),
    totale: rs.rows.length,
    classificati,
    docs,
    nodi: Object.fromEntries(nodi),
  });

  const kb = Math.round(fs.statSync(USCITA).size / 1024);
  const residuo = rs.rows.length - classificati;
  console.log(
    `[build-topics] ${rs.rows.length} documenti · ${classificati} classificati · ` +
      `${residuo} nel residuo · ${nodi.size} nodi popolati · ` +
      `${kb} kB in ${Date.now() - t0} ms`
  );
}

main().catch((err) => {
  // Un problema di rete non deve far fallire il deploy: si ripiega a runtime.
  console.warn("[build-topics] indice non generato:", err?.message ?? err);
  scrivi(VUOTO);
});
