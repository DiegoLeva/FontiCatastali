import { getDb } from "@/lib/db";
import { EMBEDDING_MODEL, LLM_MODEL, ripristinoQuota } from "@/lib/cloudflare";
import { statoBudget, type StatoBudget } from "./budget";
import { statoVectorize, type StatoVectorize } from "./vectorize";
import { generazioniOggi } from "@/lib/studio/cache";
import { MAX_GENERAZIONI_GIORNO, TETTO_DOSSIER } from "@/lib/studio/limiti";
import { MODELLO_ANALISI } from "@/lib/studio/analisi";
import { MODELLO_STESURA } from "@/lib/studio/stesura";

/** Stato delle risorse gratuite (neuroni di oggi, Vectorize, Studio) per pagine e API. */
export interface StatoRisorse {
  ai: StatoBudget;
  vectorize: StatoVectorize;
  studio: { generazioniOggi: number; maxGiorno: number; tettoDossier: number };
  ripristino: { ora: string; secondi: number };
  modelli: { llm: string; analisi: string; stesura: string; embedding: string };
}

export async function leggiStatoRisorse(): Promise<StatoRisorse> {
  const [ai, vectorize, generazioni] = await Promise.all([
    statoBudget(true),
    statoVectorize(),
    (async () => {
      try {
        return await generazioniOggi(getDb());
      } catch {
        return 0;
      }
    })(),
  ]);
  return {
    ai,
    vectorize,
    studio: { generazioniOggi: generazioni, maxGiorno: MAX_GENERAZIONI_GIORNO, tettoDossier: TETTO_DOSSIER },
    ripristino: ripristinoQuota(),
    modelli: { llm: LLM_MODEL, analisi: MODELLO_ANALISI, stesura: MODELLO_STESURA, embedding: EMBEDDING_MODEL },
  };
}
