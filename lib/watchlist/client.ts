"use client";

import { useEffect, useState } from "react";

/**
 * Watchlist nel browser: argomenti seguiti e data dell'ultima visita alla
 * pagina degli aggiornamenti, in localStorage (nessun account). Ogni accesso
 * e' protetto: in navigazione privata o con lo storage bloccato la funzione
 * si spegne in silenzio. Il server riceve solo l'argomento (registro anonimo).
 */

export interface ArgomentoSeguito {
  argomento: string;
  /** Quando l'utente ha iniziato a seguirlo (ISO). */
  dal: string;
}

export interface NovitaArgomento {
  argomento: string;
  atti: Array<{ id: number; titolo: string; anno: string; cartella: string; url: string; importatoIl: string }>;
}

export interface RispostaNovita {
  dal: string;
  totale: number;
  argomenti: NovitaArgomento[];
}

const CHIAVE = "fc:argomenti-seguiti:v1";
const VISITA = "fc:ultima-visita-aggiornamenti:v1";
const EVENTO = "fc:watchlist";
const MAX = 30;

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim();

export function leggiSeguiti(): ArgomentoSeguito[] {
  try {
    const v = JSON.parse(localStorage.getItem(CHIAVE) ?? "[]") as unknown;
    return Array.isArray(v)
      ? v.filter((x): x is ArgomentoSeguito => !!x && typeof x.argomento === "string" && typeof x.dal === "string").slice(-MAX)
      : [];
  } catch {
    return [];
  }
}

function scrivi(lista: ArgomentoSeguito[]): void {
  try {
    localStorage.setItem(CHIAVE, JSON.stringify(lista.slice(-MAX)));
  } catch {
    /* storage non disponibile */
  }
  try {
    window.dispatchEvent(new Event(EVENTO));
  } catch {
    /* fuori dal browser */
  }
}

function registra(argomento: string, azione: "segui" | "smetti"): void {
  fetch("/api/watchlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ argomento, azione }),
    keepalive: true,
  }).catch(() => undefined);
}

export const eSeguito = (argomento: string) => leggiSeguiti().some((s) => norm(s.argomento) === norm(argomento));

export function segui(argomento: string): void {
  const a = argomento.replace(/\s+/g, " ").trim().slice(0, 80);
  if (a.length < 2 || eSeguito(a)) return;
  scrivi([...leggiSeguiti(), { argomento: a, dal: new Date().toISOString() }]);
  registra(a, "segui");
}

export function smetti(argomento: string): void {
  scrivi(leggiSeguiti().filter((s) => norm(s.argomento) !== norm(argomento)));
  registra(argomento, "smetti");
}

export function ultimaVisita(): string | null {
  try {
    return localStorage.getItem(VISITA);
  } catch {
    return null;
  }
}

export function segnaVisita(): void {
  try {
    localStorage.setItem(VISITA, new Date().toISOString());
    sessionStorage.removeItem(CACHE);
  } catch {
    /* storage non disponibile */
  }
  try {
    window.dispatchEvent(new Event(EVENTO));
  } catch {
    /* fuori dal browser */
  }
}

/** Argomenti seguiti, aggiornati in tempo reale (anche tra schede). */
export function useSeguiti(): ArgomentoSeguito[] {
  const [lista, setLista] = useState<ArgomentoSeguito[]>([]);
  useEffect(() => {
    const aggiorna = () => setLista(leggiSeguiti());
    aggiorna();
    window.addEventListener(EVENTO, aggiorna);
    window.addEventListener("storage", aggiorna);
    return () => {
      window.removeEventListener(EVENTO, aggiorna);
      window.removeEventListener("storage", aggiorna);
    };
  }, []);
  return lista;
}

/** Da quando cercare novita': ultima visita o, se manca, l'inizio del seguito. */
export function dataRiferimento(lista: ArgomentoSeguito[]): string {
  const visita = ultimaVisita();
  const inizio = lista.map((s) => s.dal).sort()[0];
  return (visita ?? inizio ?? new Date().toISOString()).slice(0, 10);
}

const CACHE = "fc:novita-cache:v1";
const DURATA_CACHE_MS = 30 * 60_000;

/** Novita' per gli argomenti seguiti (cache in sessione per 30 minuti). */
export async function caricaNovita(lista: ArgomentoSeguito[], dal = dataRiferimento(lista)): Promise<RispostaNovita | null> {
  if (!lista.length) return { dal, totale: 0, argomenti: [] };
  const params = new URLSearchParams({ dal });
  for (const s of [...lista].sort((a, b) => a.argomento.localeCompare(b.argomento))) params.append("a", s.argomento);
  const chiave = params.toString();
  try {
    const c = JSON.parse(sessionStorage.getItem(CACHE) ?? "null") as { chiave: string; il: number; dati: RispostaNovita } | null;
    if (c && c.chiave === chiave && Date.now() - c.il < DURATA_CACHE_MS) return c.dati;
  } catch {
    /* cache non leggibile */
  }
  try {
    const res = await fetch(`/api/watchlist/novita?${chiave}`);
    if (!res.ok) return null;
    const dati = (await res.json()) as RispostaNovita;
    try {
      sessionStorage.setItem(CACHE, JSON.stringify({ chiave, il: Date.now(), dati }));
    } catch {
      /* cache non scrivibile */
    }
    return dati;
  } catch {
    return null;
  }
}
