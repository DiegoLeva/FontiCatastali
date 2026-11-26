/**
 * Limiti di costo dello Studio Normativo (condivisi da route, pipeline e
 * pagina di stato). Pensati per restare nella quota gratuita di Workers AI.
 */

const intero = (v: string | undefined, predefinito: number, min: number, max: number) => {
  const n = Number(v);
  return v !== undefined && v.trim() !== "" && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : predefinito;
};

/** Nuovi dossier (non in cache) al giorno UTC. */
export const MAX_GENERAZIONI_GIORNO = intero(process.env.STUDIO_MAX_GIORNO, 4, 0, 4);
/** Tetto di neuroni del singolo dossier (mai oltre 2.500). */
export const TETTO_DOSSIER = intero(process.env.STUDIO_NEURONI_DOSSIER, 2_500, 300, 2_500);
/** Sotto questa soglia di neuroni residui un dossier non ci sta: non si parte. */
export const MINIMO_NEURONI_DOSSIER = 700;
