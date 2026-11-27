import fs from "node:fs";

/**
 * Per gli script da riga di comando: carica .env.local (poi .env) se presenti.
 * Le variabili gia' impostate nell'ambiente hanno la precedenza.
 */
for (const file of [".env.local", ".env"]) {
  if (fs.existsSync(file)) process.loadEnvFile(file);
}
