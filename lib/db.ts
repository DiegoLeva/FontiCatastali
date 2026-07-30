import { createClient, type Client } from "@libsql/client";

/**
 * Client Turso/libSQL singleton (riusato tra invocazioni serverless a caldo).
 * Configurazione via env:
 *   TURSO_DATABASE_URL = libsql://<db>-<org>.turso.io
 *   TURSO_AUTH_TOKEN   = token generato con `turso db tokens create`
 */
let client: Client | null = null;

export function getDb(): Client {
  if (client) return client;

  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    throw new Error(
      "TURSO_DATABASE_URL non configurato. Copia .env.example in .env.local."
    );
  }

  client = createClient({ url, authToken });
  return client;
}
