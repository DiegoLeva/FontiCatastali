/**
 * Bonifica dei metadati del corpus da riga di comando (idempotente).
 *
 *   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... \
 *     npx tsx scripts/bonifica-metadati.ts            # prova a secco + rapporto
 *   ... npx tsx scripts/bonifica-metadati.ts --applica
 *
 * Il rapporto completo (modifiche e casi da revisionare) viene salvato in
 * bonifica-metadati-<data>.json nella cartella corrente.
 */
import fs from "node:fs";

async function main() {
  const applica = process.argv.includes("--applica");
  const { getDb } = await import("../lib/db");
  const { eseguiBonifica } = await import("../lib/metadati/bonifica");
  const db = getDb();
  let da = 0;
  const totale = { esaminati: 0, modificati: 0, anni: 0, titoli: 0, duplicati: 0, daRevisionare: 0 };
  const modifiche: unknown[] = [];
  const revisione: unknown[] = [];
  for (;;) {
    const r = await eseguiBonifica(db, { applica, daId: da || undefined, budgetMs: 600_000 });
    for (const k of Object.keys(totale) as Array<keyof typeof totale>) totale[k] += r[k];
    modifiche.push(...r.modifiche);
    revisione.push(...r.revisione);
    console.log(`  tappa fino all'id ${r.ultimoId}: ${r.esaminati} esaminati, ${r.modificati} modificati`);
    if (r.completata) break;
    da = r.ultimoId;
  }
  const file = `bonifica-metadati-${new Date().toISOString().slice(0, 10)}.json`;
  fs.writeFileSync(file, JSON.stringify({ applica, totale, modifiche, revisione }, null, 2));
  console.log(`${applica ? "Applicata" : "Prova a secco"}: ${JSON.stringify(totale)}\nRapporto: ${file}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
