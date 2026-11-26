import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { leggiStato } from "@/lib/aggiornamenti/stato";
import { leggiStatoRisorse, type StatoRisorse } from "@/lib/ai/stato";
import { StatoRisorseSezione } from "@/components/StatoRisorse";
import type { EsecuzioneRiepilogo, EsitoEsecuzione, StatoAggiornamenti } from "@/lib/aggiornamenti/tipi";
import { docUrl } from "@/lib/docs";

export const metadata: Metadata = {
  title: "Stato aggiornamenti",
  description: "Esito del controllo automatico settimanale delle nuove fonti normative catastali.",
};

// Pagina statica rigenerata al massimo ogni minuto: nessun accesso al DB per visita.
export const revalidate = 60;

const ESITI: Record<EsitoEsecuzione, { label: string; tono: "ok" | "warn" | "ko" | "neutro" }> = {
  ok: { label: "Completato con novità", tono: "ok" },
  nessuna_novita: { label: "Completato, nessuna novità", tono: "ok" },
  parziale: { label: "Parziale (con avvisi)", tono: "warn" },
  errore: { label: "Errore", tono: "ko" },
  interrotta: { label: "Interrotto", tono: "ko" },
  saltata: { label: "Saltato (già in corso)", tono: "neutro" },
  in_corso: { label: "In corso", tono: "neutro" },
};

const TONI = {
  ok: "border-[#0a7a3433] bg-[#0a7a340d] text-[#0a6b2e] dark:text-[#5fd38d]",
  warn: "border-[#b4530933] bg-[#b453090d] text-[#9a4a07] dark:text-[#f5b86a]",
  ko: "border-[#ee000033] bg-[#ee00000d] text-[#c50000] dark:text-[#ff6666]",
  neutro: "border-hairline bg-canvas-soft text-body",
};

function data(iso: string | null | undefined, conOra = true): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("it-IT", {
    timeZone: "Europe/Rome",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(conOra ? { hour: "2-digit", minute: "2-digit" } : {}),
  });
}

function Pill({ esito }: { esito: EsitoEsecuzione }) {
  const e = ESITI[esito] ?? ESITI.in_corso;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11.5px] font-medium ${TONI[e.tono]}`}>
      {e.label}
    </span>
  );
}

function Check({ ok, label, nota }: { ok: boolean; label: string; nota?: string }) {
  return (
    <li className="flex items-start gap-2.5 py-1.5">
      <span
        aria-hidden
        className={`mt-1 h-2 w-2 shrink-0 rounded-full ${ok ? "bg-[#0a7a34] dark:bg-[#5fd38d]" : "bg-[#c50000] dark:bg-[#ff6666]"}`}
      />
      <span className="text-[13.5px] text-body">
        <span className="font-medium text-ink">{label}</span> — {ok ? "configurato" : "mancante"}
        {nota && <span className="block text-[12.5px] text-mute">{nota}</span>}
      </span>
    </li>
  );
}

function Riepilogo({ e }: { e: EsecuzioneRiepilogo }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Pill esito={e.esito} />
        <span className="font-mono text-[12px] text-mute">
          {data(e.avviataIl)} · {e.innesco} · {e.durataMs != null ? `${(e.durataMs / 1000).toFixed(1)} s` : "—"}
        </span>
      </div>
      <p className="text-[14px] leading-relaxed text-body">{e.messaggio || "—"}</p>
      <dl className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {[
          ["Fonti", `${e.fontiControllate - e.fontiInErrore}/${e.fontiControllate}`],
          ["In elenco", e.vociLette],
          ["Nuovi", e.nuoveVoci],
          ["Importati", e.importati],
          ["Duplicati", e.duplicati],
          ["Errori", e.errori],
        ].map(([k, v]) => (
          <div key={String(k)} className="rounded-ds border border-hairline bg-canvas-soft px-2.5 py-2">
            <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-mute">{k}</dt>
            <dd className="mt-0.5 font-mono text-[15px] font-semibold tabular-nums text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      {e.fonti && e.fonti.length > 0 && (
        <ul className="divide-y divide-hairline rounded-ds border border-hairline">
          {e.fonti.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[13px]">
              <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${f.ok ? "bg-[#0a7a34] dark:bg-[#5fd38d]" : "bg-[#c50000] dark:bg-[#ff6666]"}`} />
              <a href={f.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 truncate text-ink hover:text-link">
                {f.nome}
              </a>
              <span className="font-mono text-[11.5px] tabular-nums text-mute">
                {f.voci} voci · {f.nuove} nuove · HTTP {f.httpStatus ?? "—"} · {f.ms} ms
              </span>
              {f.errore && <span className="w-full text-[12.5px] text-[#c50000] dark:text-[#ff6666]">{f.errore}</span>}
            </li>
          ))}
        </ul>
      )}
      {e.dettagliErrori && e.dettagliErrori.length > 0 && (
        <details className="rounded-ds border border-hairline bg-canvas-soft px-3 py-2 text-[12.5px] text-body">
          <summary className="cursor-pointer font-medium text-ink">Dettagli degli avvisi ({e.dettagliErrori.length})</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {e.dettagliErrori.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

async function carica(): Promise<{ stato: StatoAggiornamenti | null; errore: string | null }> {
  try {
    return { stato: await leggiStato(), errore: null };
  } catch (err) {
    console.error("[/aggiornamenti] errore:", err);
    return { stato: null, errore: "Impossibile leggere lo stato dal database in questo momento." };
  }
}

async function caricaRisorse(): Promise<StatoRisorse | null> {
  try {
    return await leggiStatoRisorse();
  } catch (err) {
    console.error("[/aggiornamenti] risorse:", err);
    return null;
  }
}

export default async function AggiornamentiPage() {
  const [{ stato, errore }, risorse] = await Promise.all([carica(), caricaRisorse()]);

  return (
    <main className="min-h-dvh px-4 pb-24 pt-5 sm:pt-8">
      <SiteHeader attiva="aggiornamenti" />

      <div className="mx-auto mt-8 max-w-3xl">
        <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-mute">Aggiornamento automatico</p>
        <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-display-sm text-ink sm:text-[32px]">
          Stato delle fonti
        </h1>
        <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-body">
          Ogni settimana l&apos;archivio controlla circolari, risoluzioni e provvedimenti
          pubblicati dall&apos;Agenzia delle Entrate, scarica quelli che riguardano il
          catasto e la pubblicità immobiliare e li aggiunge al database (ricerca, mappa
          degli argomenti, Studio Normativo e Normie).
        </p>

        {errore && (
          <div className={`mt-6 rounded-ds border p-4 text-[14px] ${TONI.ko}`}>{errore}</div>
        )}

        {stato && (
          <div className="mt-8 space-y-8">
            {stato.avvisi.length > 0 && (
              <section className={`rounded-ds border p-4 ${TONI.warn}`} aria-label="Avvisi">
                <ul className="list-disc space-y-1 pl-5 text-[13.5px]">
                  {stato.avvisi.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </section>
            )}

            <section className="rounded-ds-lg border border-hairline bg-canvas p-5 shadow-ds">
              <h2 className="mb-4 font-mono text-[11.5px] uppercase tracking-[0.14em] text-mute">Ultima esecuzione</h2>
              {stato.ultimaEsecuzione ? <Riepilogo e={stato.ultimaEsecuzione} /> : <p className="text-[14px] text-body">Nessuna esecuzione registrata.</p>}
              {stato.ultimoSuccesso && stato.ultimoSuccesso.id !== stato.ultimaEsecuzione?.id && (
                <p className="mt-4 border-t border-hairline pt-3 text-[13px] text-body">
                  Ultimo controllo riuscito: <span className="font-medium text-ink">{data(stato.ultimoSuccesso.avviataIl)}</span>
                </p>
              )}
            </section>

            {risorse && <StatoRisorseSezione r={risorse} />}

            <section className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-ds-lg border border-hairline bg-canvas p-5 shadow-ds">
                <h2 className="mb-3 font-mono text-[11.5px] uppercase tracking-[0.14em] text-mute">Pianificazione</h2>
                <p className="text-[14px] leading-relaxed text-body">{stato.pianificazione.descrizione}</p>
                <p className="mt-3 text-[13px] text-body">
                  Prossimo controllo: <span className="font-medium text-ink">{data(stato.pianificazione.prossima)}</span>
                </p>
                <p className="mt-1 font-mono text-[11.5px] text-mute">cron: {stato.pianificazione.cron} (UTC)</p>
              </div>
              <div className="rounded-ds-lg border border-hairline bg-canvas p-5 shadow-ds">
                <h2 className="mb-2 font-mono text-[11.5px] uppercase tracking-[0.14em] text-mute">Configurazione</h2>
                <ul>
                  <Check ok={stato.configurazione.cronSecret} label="CRON_SECRET" nota="Autentica il cron di Vercel." />
                  <Check ok={stato.configurazione.turso} label="Database Turso" />
                  <Check ok={stato.configurazione.cloudflare} label="Cloudflare (titoli e Normie)" />
                  <Check ok={stato.configurazione.webhook} label="Notifiche webhook (opzionale)" nota="AGGIORNAMENTI_WEBHOOK_URL: Slack, Discord o Teams." />
                </ul>
                <p className="mt-2 font-mono text-[11.5px] text-mute">{stato.documenti.toLocaleString("it-IT")} documenti nel corpus</p>
              </div>
            </section>

            <section>
              <h2 className="mb-3 font-mono text-[11.5px] uppercase tracking-[0.14em] text-mute">Atti rilevati di recente</h2>
              {stato.voci.length === 0 ? (
                <p className="rounded-ds border border-dashed border-hairline p-5 text-center text-[13.5px] text-mute">
                  Nessun atto catastale importato finora.
                </p>
              ) : (
                <ul className="divide-y divide-hairline overflow-hidden rounded-ds-lg border border-hairline bg-canvas shadow-ds">
                  {stato.voci.map((v) => (
                    <li key={v.url} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-3">
                      <span className="flex min-w-0 flex-1 flex-col">
                        {v.docId ? (
                          <Link href={`/documento/${v.docId}`} className="line-clamp-2 text-[13.5px] font-medium text-ink hover:text-link">
                            {v.titolo}
                          </Link>
                        ) : (
                          <a href={docUrl(v.cartella, v.url)} target="_blank" rel="noopener noreferrer" className="line-clamp-2 text-[13.5px] font-medium text-ink hover:text-link">
                            {v.titolo}
                          </a>
                        )}
                        <span className="text-[12px] text-mute">
                          {v.cartella || v.fonte} · {v.data ? data(v.data, false) : v.anno ?? "s.d."}
                          {v.motivo ? ` · ${v.motivo}` : ""}
                        </span>
                      </span>
                      <span className={`self-start rounded-full border px-2 py-0.5 text-[11px] font-medium sm:self-center ${
                        v.stato === "importato" ? TONI.ok : v.stato === "errore" ? TONI.ko : TONI.neutro
                      }`}>
                        {v.stato}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h2 className="mb-3 font-mono text-[11.5px] uppercase tracking-[0.14em] text-mute">Registro delle esecuzioni</h2>
              {stato.esecuzioni.length === 0 ? (
                <p className="text-[13.5px] text-mute">Vuoto.</p>
              ) : (
                <div className="overflow-x-auto rounded-ds-lg border border-hairline bg-canvas shadow-ds">
                  <table className="w-full min-w-[560px] text-left text-[12.5px]">
                    <thead className="border-b border-hairline font-mono text-[10.5px] uppercase tracking-[0.12em] text-mute">
                      <tr>
                        <th className="px-3 py-2 font-normal">Avvio</th>
                        <th className="px-3 py-2 font-normal">Esito</th>
                        <th className="px-3 py-2 font-normal">Innesco</th>
                        <th className="px-3 py-2 text-right font-normal">Nuovi</th>
                        <th className="px-3 py-2 text-right font-normal">Importati</th>
                        <th className="px-3 py-2 text-right font-normal">Errori</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline">
                      {stato.esecuzioni.map((e) => (
                        <tr key={e.id}>
                          <td className="whitespace-nowrap px-3 py-2 text-body">{data(e.avviataIl)}</td>
                          <td className="px-3 py-2"><Pill esito={e.esito} /></td>
                          <td className="px-3 py-2 text-body">{e.innesco}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">{e.nuoveVoci}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">{e.importati}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">{e.errori}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <p className="text-[12px] text-mute">
              Aggiornato {data(stato.generatoIl)} · dati JSON:{" "}
              <a href="/api/aggiornamenti/stato" className="underline underline-offset-4 hover:text-ink">/api/aggiornamenti/stato</a>
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
