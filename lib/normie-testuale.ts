import type { Client } from "@libsql/client";
import { espandiArgomento, paroleSignificative, termine } from "@/lib/studio/espansione";
import { estraiDaTesto } from "@/lib/studio/recupero";
import { haMetadati } from "@/lib/metadati/bonifica";
import type { RetrievedChunk } from "@/lib/normie";

/**
 * Recupero TESTUALE per Normie, senza Vectorize: indice FTS5 di Turso
 * (bm25) + estratti dei testi integrali attorno alle parole della domanda.
 * Il cross-encoder della route riordina poi i passaggi. Si usa quando la
 * ricerca vettoriale e' sospesa per restare nelle quote gratuite.
 */

const STOP_DOMANDA = new Set(
  ("quale quali quando dove cosa chi perche posso puo possono devo deve devono serve servono occorre bisogna fare " +
    "fatto cos sia siano essere stato stata stati ho hai ha hanno abbiamo avere mio mia miei mie suo sua suoi loro " +
    "questo questa questi queste quello quella quelli ogni tutto tutti tutte anche ancora gia molto poco meno caso casi " +
    "modo spiegami dimmi vorrei sapere grazie ciao salve buongiorno qual quanto quanti quante cioe ossia oppure")
    .split(" ")
);

export interface FiltriTestuali {
  categorie?: string[];
  annoDa?: number;
  annoA?: number;
}

const segnaposti = (n: number) => Array.from({ length: n }, () => "?").join(",");

export async function recuperoTestuale(
  db: Client,
  domanda: string,
  filtri?: FiltriTestuali,
  maxDocumenti = 12
): Promise<RetrievedChunk[]> {
  const parole = [...new Set(paroleSignificative(domanda, STOP_DOMANDA))].slice(0, 10);
  if (!parole.length) return [];
  const termini = parole.map((p) => termine(p)).filter((t) => t.fts && t.regex);
  // Tesauro deterministico: "volture" porta con se' "domanda di voltura", "Voltura 2.0"...
  const extra = espandiArgomento(parole.join(" ")).concetti.filter((c) => c.origine === "tesauro" && !c.codice).slice(0, 6);
  const fts = [...termini.map((t) => t.fts), ...extra.map((c) => `(${c.fts})`)].join(" OR ");
  if (!fts) return [];

  const condizioni: string[] = [];
  const args: Array<string | number> = [fts];
  const categorie = (filtri?.categorie ?? []).filter((c) => typeof c === "string" && c.trim()).slice(0, 12);
  if (categorie.length) {
    condizioni.push(`d.cartella_origine IN (${segnaposti(categorie.length)})`);
    args.push(...categorie.map((c) => c.trim().slice(0, 120)));
  }
  const annoOk = (v: unknown) => Number.isFinite(v) && Number(v) >= 1800 && Number(v) <= 2100;
  if (annoOk(filtri?.annoDa)) {
    condizioni.push(`d.anno >= ?`);
    args.push(Number(filtri!.annoDa));
  }
  if (annoOk(filtri?.annoA)) {
    condizioni.push(`d.anno <= ?`);
    args.push(Number(filtri!.annoA));
  }
  args.push(maxDocumenti);

  const meta = await haMetadati(db);
  if (meta) condizioni.push("m.duplicato_di IS NULL");
  const rs = await db.execute({
    sql: `SELECT d.id, d.titolo, d.cartella_origine AS cartella, d.nuovo_nome_file AS nome, d.anno,
                 substr(d.testo_estratto, 1, 160000) AS testo
          FROM documenti_fts JOIN documenti d ON d.id = documenti_fts.rowid
          ${meta ? "LEFT JOIN documenti_meta m ON m.doc_id = d.id" : ""}
          WHERE documenti_fts MATCH ?${condizioni.length ? ` AND ${condizioni.join(" AND ")}` : ""}
          ORDER BY bm25(documenti_fts, 1.0, 8.0, 4.0) LIMIT ?`,
    args,
  });

  const regex = [...termini.map((t) => new RegExp(t.regex, "giu")), ...extra.map((c) => new RegExp(c.regex, "giu"))];
  const passaggi: RetrievedChunk[] = [];
  rs.rows.forEach((r, i) => {
    const e = estraiDaTesto(String(r.testo ?? ""), regex, 3, 900);
    const testi = e.passaggi.length ? e.passaggi : e.incipit ? [e.incipit] : [];
    for (const t of testi) {
      passaggi.push({
        metadata: {
          docId: Number(r.id),
          titolo: String(r.titolo ?? ""),
          cartella: String(r.cartella ?? ""),
          nomeFile: String(r.nome ?? ""),
          anno: String(r.anno ?? ""),
        },
        testo: t,
        score: 1 / (1 + i),
      });
    }
  });
  return passaggi;
}
