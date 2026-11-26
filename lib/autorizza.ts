import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

/** Confronto a tempo costante (nessuna fuga di informazioni sul segreto). */
export function uguali(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Header `Authorization: Bearer <CRON_SECRET>` valido (fail closed senza segreto). */
export function conSegreto(req: NextRequest): boolean {
  const segreto = process.env.CRON_SECRET;
  return !!segreto && uguali(req.headers.get("authorization") ?? "", `Bearer ${segreto}`);
}

/** Anteprima Vercel (protetta da Vercel Authentication) o sviluppo locale. */
export const inAnteprima = () => process.env.VERCEL_ENV === "preview" || process.env.NODE_ENV === "development";
