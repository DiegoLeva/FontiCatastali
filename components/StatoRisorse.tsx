import type { StatoRisorse } from "@/lib/ai/stato";

const it = (n: number) => Math.round(n).toLocaleString("it-IT");
const milioni = (n: number) => `${(n / 1e6).toLocaleString("it-IT", { maximumFractionDigits: 1 })} M`;

function Barra({ valore, massimo, etichetta }: { valore: number; massimo: number; etichetta: string }) {
  const perc = massimo > 0 ? Math.min(100, (valore / massimo) * 100) : 100;
  const tono = perc >= 100 ? "bg-[#c50000] dark:bg-[#ff6666]" : perc >= 80 ? "bg-[#b45309] dark:bg-[#f5b86a]" : "bg-[#0a7a34] dark:bg-[#5fd38d]";
  return (
    <div
      className="mt-2 h-2 w-full overflow-hidden rounded-full bg-canvas-soft-2"
      role="meter"
      aria-label={etichetta}
      aria-valuemin={0}
      aria-valuemax={massimo}
      aria-valuenow={Math.round(valore)}
    >
      <div className={`h-full rounded-full ${tono}`} style={{ width: `${perc}%` }} />
    </div>
  );
}

/**
 * Consumo delle risorse gratuite: neuroni di Workers AI rispetto al tetto
 * dell'app (sotto i 10.000 gratuiti), dossier dello Studio, quote Vectorize.
 */
export function StatoRisorseSezione({ r }: { r: StatoRisorse }) {
  const { ai, vectorize: v, studio } = r;
  const esaurito = !ai.disponibile;
  return (
    <section className="rounded-ds-lg border border-hairline bg-canvas p-5 shadow-ds" aria-labelledby="titolo-risorse">
      <h2 id="titolo-risorse" className="mb-3 font-mono text-[11.5px] uppercase tracking-[0.14em] text-mute">
        Risorse gratuite di oggi (UTC {ai.giorno})
      </h2>

      {ai.nonDisponibile ? (
        <p className="text-[14px] text-body">Contatore dei neuroni non raggiungibile: le funzioni AI sono sospese per prudenza.</p>
      ) : (
        <>
          <p className="text-[14px] text-body">
            Neuroni Workers AI: <span className="font-semibold text-ink tabular-nums">{it(ai.usati)}</span> / {it(ai.limite)}
            <span className="text-mute"> · tetto dell&apos;app, sotto i {it(ai.quotaGratuita)} gratuiti · si azzera alle {r.ripristino.ora}</span>
          </p>
          <Barra valore={ai.usati} massimo={ai.limite} etichetta="Neuroni usati oggi rispetto al tetto" />
          {esaurito && (
            <p className="mt-2 text-[13px] text-[#9a4a07] dark:text-[#f5b86a]">
              Budget di oggi esaurito: Normie e le nuove generazioni dello Studio riprendono alle {r.ripristino.ora}. Ricerca, dossier già pronti e fonti restano disponibili.
            </p>
          )}
          <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] text-body sm:grid-cols-4">
            <li>Studio: <span className="tabular-nums text-ink">{it(ai.perServizio.studio)}</span></li>
            <li>Normie: <span className="tabular-nums text-ink">{it(ai.perServizio.normie)}</span></li>
            <li>Cron: <span className="tabular-nums text-ink">{it(ai.perServizio.cron)}</span></li>
            <li>Altro: <span className="tabular-nums text-ink">{it(ai.perServizio.altro)}</span></li>
          </ul>
          <p className="mt-2 text-[12.5px] text-mute">
            {it(ai.riserva)} neuroni restano riservati a Normie e al cron (lo Studio si ferma a {it(ai.limiteStudio)}) · {it(ai.chiamate)} chiamate
            {ai.bloccate ? ` · ${it(ai.bloccate)} bloccate prima dell'invio` : ""}
          </p>
          <p className="mt-1 text-[12.5px] text-mute">
            {ai.remoto !== null
              ? `Consumo reale dell'account letto da Cloudflare: ${it(ai.remoto)} neuroni (il contatore usa il maggiore dei due).`
              : `Consumo reale dell'account non letto da Cloudflare${ai.sincronizzazione.errore ? ` (${ai.sincronizzazione.errore})` : ""}: per allinearlo aggiungi al token il permesso «Account Analytics: Read».`}
          </p>
          {ai.nota && <p className="mt-1 text-[12.5px] text-mute">{ai.nota}</p>}
        </>
      )}

      <div className="mt-4 border-t border-hairline pt-3 text-[13px] text-body">
        Studio Normativo: <span className="font-medium text-ink tabular-nums">{studio.generazioniOggi}</span> / {studio.maxGiorno} nuovi dossier oggi
        <span className="text-mute"> · massimo {it(studio.tettoDossier)} neuroni per dossier · i dossier già generati sono sempre gratuiti</span>
      </div>

      <div className="mt-3 border-t border-hairline pt-3 text-[13px] text-body">
        <p>
          Vectorize (ricerca semantica di Normie):{" "}
          <span className={`font-medium ${v.consentito ? "text-[#0a6b2e] dark:text-[#5fd38d]" : "text-[#9a4a07] dark:text-[#f5b86a]"}`}>
            {v.consentito ? "attiva" : "sospesa"}
          </span>
        </p>
        <p className="mt-1 text-[12.5px] text-mute">{v.motivo}</p>
        {v.dimensioni > 0 && (
          <p className="mt-1 text-[12.5px] text-mute">
            Indice: {it(v.vettori)} vettori × {v.dimensioni} dimensioni = {milioni(v.memorizzate)} memorizzate (incluse nel piano: 10 M) · query questo mese: {it(v.queryMese)}
          </p>
        )}
      </div>

      <p className="mt-3 font-mono text-[11px] text-mute">
        Modello: {r.modelli.llm}
        {r.modelli.analisi !== r.modelli.llm || r.modelli.stesura !== r.modelli.llm ? ` · Studio: ${r.modelli.analisi} / ${r.modelli.stesura}` : ""}
      </p>
    </section>
  );
}
