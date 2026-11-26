"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import type {
  ConcettoEspanso,
  Dossier,
  DossierRecente,
  EventoStudio,
  FaseStudio,
  FonteStudio,
  NotaFonte,
  StatisticheDossier,
  VoceTimeline,
} from "@/lib/studio/tipi";
import { BetaBadge } from "@/components/BetaBadge";
import { SearchIcon, SpinnerIcon, ChevronIcon } from "@/components/icons";
import { Markdown, regexEvidenzia, slug, type ContestoTesto } from "./testo";
import { FonteDrawer } from "./FonteDrawer";
import { Timeline } from "./Timeline";
import { IndiceFonti } from "./IndiceFonti";
import { Progresso, type StatoFase } from "./Progresso";
import { dossierMarkdown } from "./esporta";

const SUGGERITI = [
  "Volture",
  "Fabbricati rurali",
  "Categoria F/3",
  "Tipi mappali",
  "Impianti fotovoltaici",
  "Unità collabenti F/2",
  "Beni comuni non censibili",
  "Imbullonati",
  "Docfa",
  "Rendita presunta",
];

const ORDINE_SEZIONI = ["inquadramento", "timeline", "origini", "evoluzione", "vigente", "avvertenze"];

interface SezioneViva {
  id: string;
  titolo: string;
  markdown: string;
  completa: boolean;
}

type Stato = "idle" | "caricamento" | "streaming" | "fatto" | "errore";

function dataLeggibile(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" });
}

export function StudioApp() {
  const [input, setInput] = useState("");
  const [stato, setStato] = useState<Stato>("idle");
  const [errore, setErrore] = useState("");
  const [argomento, setArgomento] = useState("");
  const [fasi, setFasi] = useState<Partial<Record<FaseStudio, StatoFase>>>({});
  const [faseCorrente, setFaseCorrente] = useState<FaseStudio | null>(null);
  const [concetti, setConcetti] = useState<ConcettoEspanso[]>([]);
  const [evidenzia, setEvidenzia] = useState<string[]>([]);
  const [fonti, setFonti] = useState<FonteStudio[]>([]);
  const [statistiche, setStatistiche] = useState<Partial<StatisticheDossier> | null>(null);
  const [note, setNote] = useState<Map<number, NotaFonte>>(new Map());
  const [sezioni, setSezioni] = useState<SezioneViva[]>([]);
  const [avvisi, setAvvisi] = useState<string[]>([]);
  // Avviso grave (es. quota AI esaurita): resta in evidenza sopra il dossier.
  const [limitazione, setLimitazione] = useState("");
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [daCache, setDaCache] = useState(false);
  const [nuoveFonti, setNuoveFonti] = useState(0);
  const [aperta, setAperta] = useState<number | null>(null);
  const [recenti, setRecenti] = useState<DossierRecente[]>([]);
  const [tocAperto, setTocAperto] = useState(false);
  const [sezioneAttiva, setSezioneAttiva] = useState<string>("");
  const [copiato, setCopiato] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const origineRef = useRef<HTMLElement | null>(null);
  const deltaRef = useRef<Map<string, string>>(new Map());
  const flushRef = useRef<number | null>(null);

  /* ------------------------------ Stream -------------------------------- */

  const flushDelta = useCallback(() => {
    flushRef.current = null;
    const pendenti = deltaRef.current;
    if (!pendenti.size) return;
    deltaRef.current = new Map();
    setSezioni((prev) => prev.map((s) => (pendenti.has(s.id) ? { ...s, markdown: s.markdown + pendenti.get(s.id) } : s)));
  }, []);

  const applica = useCallback(
    (e: EventoStudio) => {
      switch (e.tipo) {
        case "fase":
          setFasi((p) => ({ ...p, [e.fase]: { messaggio: e.messaggio, progresso: e.progresso } }));
          setFaseCorrente(e.fase);
          break;
        case "espansione":
          setConcetti(e.concetti);
          setEvidenzia(e.evidenzia);
          break;
        case "fonti":
          setFonti(e.fonti);
          setStatistiche(e.statistiche);
          break;
        case "note":
          setNote((p) => {
            const n = new Map(p);
            for (const x of e.note) n.set(x.n, x.nota);
            return n;
          });
          break;
        case "sezione_inizio":
          flushDelta();
          setSezioni((p) => (p.some((s) => s.id === e.id) ? p : [...p, { id: e.id, titolo: e.titolo, markdown: "", completa: false }]));
          break;
        case "delta":
          deltaRef.current.set(e.id, (deltaRef.current.get(e.id) ?? "") + e.testo);
          if (flushRef.current === null) flushRef.current = window.setTimeout(flushDelta, 60);
          break;
        case "sezione_fine":
          deltaRef.current.delete(e.id);
          setSezioni((p) => p.map((s) => (s.id === e.id ? { ...s, markdown: e.markdown, completa: true } : s)));
          break;
        case "avviso":
          if (e.grave) setLimitazione(e.messaggio);
          setAvvisi((p) => (p.includes(e.messaggio) ? p : [...p, e.messaggio]));
          break;
        case "errore":
          setErrore(e.messaggio);
          break;
        case "fine":
          flushDelta();
          setDossier(e.dossier);
          setDaCache(e.cache);
          setNuoveFonti(e.nuoveFonti ?? 0);
          setFonti(e.dossier.fonti);
          setStatistiche(e.dossier.statistiche);
          setConcetti(e.dossier.espansione);
          setEvidenzia(e.dossier.evidenzia);
          setAvvisi(e.dossier.avvisi);
          setSezioni(e.dossier.sezioni.map((s) => ({ ...s, completa: true })));
          break;
        default:
          break;
      }
    },
    [flushDelta]
  );

  const avvia = useCallback(
    async (testo: string, rigenera = false) => {
      const arg = testo.replace(/\s+/g, " ").trim();
      if (arg.length < 2) return;
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setArgomento(arg);
      setInput(arg);
      setStato("caricamento");
      setErrore("");
      setFasi({});
      setFaseCorrente(null);
      setConcetti([]);
      setEvidenzia([]);
      setFonti([]);
      setStatistiche(null);
      setNote(new Map());
      setSezioni([]);
      setAvvisi([]);
      setLimitazione("");
      setDossier(null);
      setDaCache(false);
      setNuoveFonti(0);
      setAperta(null);
      deltaRef.current = new Map();

      const url = new URL(window.location.href);
      url.searchParams.set("argomento", arg);
      window.history.replaceState(null, "", url);

      let finito = false;
      let erroreServer = false;
      try {
        const res = await fetch("/api/studio", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ argomento: arg, rigenera }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          const j = (await res.json().catch(() => null)) as { error?: string } | null;
          setErrore(j?.error ?? `Servizio non disponibile (HTTP ${res.status}).`);
          setStato("errore");
          return;
        }
        setStato("streaming");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const righe = buffer.split("\n");
          buffer = righe.pop() ?? "";
          for (const r of righe) {
            if (!r.trim()) continue;
            try {
              const ev = JSON.parse(r) as EventoStudio;
              if (ev.tipo === "fine") finito = true;
              if (ev.tipo === "errore") erroreServer = true;
              applica(ev);
            } catch {
              /* riga non valida: ignorata */
            }
          }
        }
        if (buffer.trim()) {
          try {
            const ev = JSON.parse(buffer) as EventoStudio;
            if (ev.tipo === "fine") finito = true;
            applica(ev);
          } catch {
            /* ignorata */
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setErrore("Connessione interrotta: la generazione prosegue comunque sul server. Tra un paio di minuti riapri l'argomento (o cercalo tra i dossier già generati) per trovarlo completo.");
      }
      flushDelta();
      if (finito) setStato("fatto");
      else {
        if (!erroreServer)
          setErrore((e) => e || "Lo stream si è interrotto prima della fine: la generazione prosegue sul server. Riapri l'argomento tra un paio di minuti.");
        setStato("errore");
      }
    },
    [applica, flushDelta]
  );

  // Indirizzo condivisibile: /studio?argomento=volture
  useEffect(() => {
    const iniziale = new URLSearchParams(window.location.search).get("argomento");
    if (iniziale) void avvia(iniziale);
    fetch("/api/studio?recenti=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { recenti?: DossierRecente[] } | null) => j?.recenti && setRecenti(j.recenti))
      .catch(() => undefined);
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------ Derivati ------------------------------ */

  const fontiVive = useMemo(
    () => (dossier ? dossier.fonti : fonti.map((f) => (note.has(f.n) ? { ...f, nota: note.get(f.n) } : f))),
    [dossier, fonti, note]
  );
  const perN = useMemo(() => new Map(fontiVive.map((f) => [f.n, f])), [fontiVive]);
  const re = useMemo(() => regexEvidenzia(evidenzia), [evidenzia]);
  const timeline: VoceTimeline[] = useMemo(() => {
    if (dossier) return dossier.timeline;
    return fontiVive
      .filter((f) => f.livello === "analizzata" && f.nota)
      .map((f) => ({ anno: f.anno, n: f.n, ruolo: f.nota!.ruolo, stato: f.nota!.stato, cambiamento: f.nota!.novita || f.nota!.sintesi }));
  }, [dossier, fontiVive]);

  const apri = useCallback((n: number, el: HTMLElement) => {
    origineRef.current = el;
    setAperta(n);
  }, []);
  const chiudi = useCallback(() => {
    setAperta(null);
    const el = origineRef.current;
    if (el) setTimeout(() => el.focus({ preventScroll: true }), 30);
  }, []);
  const naviga = useCallback(
    (d: -1 | 1) => {
      setAperta((cur) => {
        if (cur === null) return cur;
        const prossimo = cur + d;
        return perN.has(prossimo) ? prossimo : cur;
      });
    },
    [perN]
  );

  const ctx: ContestoTesto = useMemo(
    () => ({ fonti: perN, onApri: apri, nonVerificati: dossier?.verifiche.riferimentiNonVerificati ?? [] }),
    [perN, apri, dossier]
  );

  const sezioniOrdinate = useMemo(() => {
    const lista: Array<SezioneViva | { id: "timeline"; titolo: string; markdown: ""; completa: boolean }> = [...sezioni];
    if (timeline.length || fonti.length) lista.push({ id: "timeline", titolo: "Timeline", markdown: "", completa: !!dossier });
    return lista.sort((a, b) => ORDINE_SEZIONI.indexOf(a.id) - ORDINE_SEZIONI.indexOf(b.id));
  }, [sezioni, timeline.length, fonti.length, dossier]);

  const toc = useMemo(
    () =>
      sezioniOrdinate.map((s) => ({
        id: `sez-${s.id}`,
        titolo: s.titolo,
        sotto: (s.markdown.match(/^###\s+(.+)$/gm) ?? []).map((h) => {
          const t = h.replace(/^###\s+/, "").replace(/\*\*/g, "");
          return { id: `sez-${s.id}-${slug(t)}`, titolo: t };
        }),
      })),
    [sezioniOrdinate]
  );

  // Capitolo attivo nell'indice (IntersectionObserver).
  useEffect(() => {
    const elementi = toc.map((t) => document.getElementById(t.id)).filter((x): x is HTMLElement => !!x);
    if (!elementi.length) return;
    const oss = new IntersectionObserver(
      (voci) => {
        const visibili = voci.filter((v) => v.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visibili[0]) setSezioneAttiva(visibili[0].target.id);
      },
      { rootMargin: "-90px 0px -60% 0px" }
    );
    elementi.forEach((el) => oss.observe(el));
    return () => oss.disconnect();
  }, [toc]);

  /* ------------------------------ Azioni -------------------------------- */

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void avvia(input);
  }

  async function copiaMd() {
    if (!dossier) return;
    try {
      await navigator.clipboard.writeText(dossierMarkdown(dossier, window.location.origin));
      setCopiato(true);
      setTimeout(() => setCopiato(false), 2000);
    } catch {
      /* clipboard non disponibile */
    }
  }
  function scaricaMd() {
    if (!dossier) return;
    const blob = new Blob([dossierMarkdown(dossier, window.location.origin)], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `studio-${slug(dossier.argomento) || "dossier"}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function vaiA(id: string) {
    setTocAperto(false);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function nuovo() {
    abortRef.current?.abort();
    setStato("idle");
    setDossier(null);
    setSezioni([]);
    setFonti([]);
    setArgomento("");
    setInput("");
    const url = new URL(window.location.href);
    url.searchParams.delete("argomento");
    window.history.replaceState(null, "", url);
  }

  const inCorso = stato === "caricamento" || stato === "streaming";
  const haContenuto = fonti.length > 0 || sezioni.length > 0;
  const fonteAperta = aperta !== null ? perN.get(aperta) ?? null : null;

  /* ------------------------------ Render -------------------------------- */

  if (stato === "idle") {
    return (
      <div className="mx-auto max-w-3xl">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="pt-[4vh] text-center sm:pt-[7vh]">
          <div className="flex items-center justify-center gap-2">
            <h1 className="text-[30px] font-semibold tracking-display-lg text-ink sm:text-[38px]">Studio Normativo</h1>
            <BetaBadge className="translate-y-1" />
          </div>
          <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-body">
            Scrivi un argomento: ricostruisco un dossier di studio cronologico su <strong className="font-medium text-ink">tutte</strong> le
            fonti del database, con origini, evoluzione, disciplina vigente e citazioni verificabili.
          </p>
        </motion.div>

        <BarraArgomento input={input} setInput={setInput} onSubmit={onSubmit} inCorso={false} />

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {SUGGERITI.map((s) => (
            <button
              key={s}
              onClick={() => void avvia(s)}
              className="rounded-full border border-hairline bg-canvas px-3 py-1.5 text-[13px] text-body shadow-ds transition hover:border-hairline-strong hover:text-ink"
            >
              {s}
            </button>
          ))}
        </div>

        {recenti.length > 0 && (
          <section className="mt-12">
            <h2 className="mb-3 font-mono text-[12px] uppercase tracking-[0.14em] text-mute">Dossier già generati</h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {recenti.map((r) => (
                <li key={r.chiave}>
                  <button
                    onClick={() => void avvia(r.argomento)}
                    className="group flex w-full items-center gap-3 rounded-ds border border-hairline bg-canvas px-4 py-3 text-left shadow-ds transition hover:border-hairline-strong"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium text-ink group-hover:text-link">{r.argomento}</span>
                      <span className="text-[12px] text-mute">
                        {r.fonti} fonti · {r.analizzate} analizzate · {dataLeggibile(r.creatoIl)}
                      </span>
                    </span>
                    <ChevronIcon className="h-4 w-4 shrink-0 text-mute group-hover:text-link" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="mx-auto mt-12 max-w-xl text-center text-[12px] leading-relaxed text-mute">
          BETA · Il dossier è generato da un modello linguistico vincolato alle fonti del database: ogni affermazione cita un
          documento consultabile, i riferimenti non verificabili sono segnalati. Non sostituisce la lettura dei testi ufficiali.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      {/* Barra superiore: argomento + azioni */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between print:hidden">
        <div className="min-w-0">
          <button onClick={nuovo} className="mb-1 flex items-center gap-1 text-[12.5px] text-mute transition hover:text-ink">
            <ChevronIcon className="h-3.5 w-3.5 rotate-180" /> Nuovo argomento
          </button>
          <div className="flex items-center gap-2">
            <h1 className="truncate text-[24px] font-semibold tracking-display-sm text-ink sm:text-[28px]">{argomento}</h1>
            <BetaBadge />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <AzioneBtn onClick={copiaMd} disabled={!dossier}>{copiato ? "Copiato ✓" : "Copia Markdown"}</AzioneBtn>
          <AzioneBtn onClick={scaricaMd} disabled={!dossier}>Scarica .md</AzioneBtn>
          <AzioneBtn onClick={() => window.print()} disabled={!dossier}>Stampa / PDF</AzioneBtn>
          <AzioneBtn onClick={() => void avvia(argomento, true)} disabled={inCorso} primario>
            {inCorso ? "Generazione…" : "Rigenera"}
          </AzioneBtn>
        </div>
      </div>

      {/* Titolo per la stampa */}
      <div className="hidden print:block">
        <h1 className="text-[24px] font-semibold">Studio normativo: {argomento}</h1>
        {dossier && <p className="text-[11px]">Generato il {dataLeggibile(dossier.creatoIl)} — FontiCatastali, Studio Normativo (BETA)</p>}
      </div>

      <div className="mt-4 space-y-3">
        {(inCorso || stato === "errore") && <Progresso fasi={fasi} corrente={faseCorrente} concluso={false} />}
        {errore && (
          <div role="alert" className="rounded-ds border border-[#ee000033] bg-[#ee00000d] p-4 text-[14px] text-[#c50000] dark:text-[#ff6666] print:hidden">
            {errore}
            <button onClick={() => void avvia(argomento)} className="ml-2 font-medium underline underline-offset-4">
              Riprova
            </button>
          </div>
        )}
        {limitazione && (
          <div role="status" className="rounded-ds border border-[#b4530940] bg-[#f9cb281f] px-4 py-3 text-[13.5px] leading-relaxed text-[#7a3a05] dark:text-[#f5b86a] print:hidden">
            <span className="font-semibold">Servizio AI in pausa. </span>
            {limitazione}
          </div>
        )}
        {daCache && dossier && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-ds border border-hairline bg-canvas-soft px-4 py-2.5 text-[13px] text-body print:hidden">
            <span>Dossier salvato il {dataLeggibile(dossier.creatoIl)}: nessuna nuova chiamata al modello.</span>
            {nuoveFonti > 0 ? (
              <button onClick={() => void avvia(argomento, true)} className="font-medium text-link underline underline-offset-4">
                {nuoveFonti} {nuoveFonti === 1 ? "nuova fonte pertinente" : "nuove fonti pertinenti"} nel DB: rigenera
              </button>
            ) : (
              <span className="text-mute">Nessuna nuova fonte pertinente da allora.</span>
            )}
          </div>
        )}
      </div>

      {statistiche && (
        <Riepilogo statistiche={statistiche} concetti={concetti} dossier={dossier} />
      )}

      {/* Indice dei capitoli su mobile */}
      {haContenuto && (
        <div className="sticky top-0 z-30 -mx-4 mt-4 border-b border-hairline bg-canvas-soft/95 px-4 py-2 backdrop-blur lg:hidden print:hidden">
          <button onClick={() => setTocAperto((v) => !v)} aria-expanded={tocAperto} className="flex w-full items-center justify-between text-[13px] font-medium text-ink">
            Indice del dossier
            <ChevronIcon className={`h-4 w-4 transition-transform ${tocAperto ? "rotate-90" : ""}`} />
          </button>
          {tocAperto && (
            <nav className="mt-2 max-h-[60dvh] overflow-y-auto pb-1">
              <TocLista toc={toc} attiva={sezioneAttiva} onVai={vaiA} />
              <button onClick={() => vaiA("sez-fonti")} className="mt-1 block py-1.5 text-left text-[13px] text-body">
                Indice delle fonti ({fontiVive.length})
              </button>
            </nav>
          )}
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[200px_minmax(0,1fr)_300px]">
        {/* Indice dei capitoli (desktop) */}
        <nav aria-label="Indice del dossier" className="hidden lg:block print:hidden">
          <div className="sticky top-6">
            <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-mute">Indice</p>
            <TocLista toc={toc} attiva={sezioneAttiva} onVai={vaiA} />
          </div>
        </nav>

        {/* Dossier */}
        <article className="min-w-0 text-[15px] text-body">
          {!haContenuto && inCorso && (
            <div className="flex items-center gap-3 rounded-ds border border-dashed border-hairline p-6 text-[14px] text-mute">
              <SpinnerIcon className="h-4 w-4" /> {fasi[faseCorrente ?? "espansione"]?.messaggio ?? "Avvio dello studio…"}
            </div>
          )}
          {sezioniOrdinate.map((s) => (
            <section key={s.id} id={`sez-${s.id}`} className="mb-10 scroll-mt-20 break-inside-avoid-page">
              <h2 className="mb-1 flex items-center gap-2 border-b border-hairline pb-2 text-[20px] font-semibold tracking-display-sm text-ink">
                {s.titolo}
                {!s.completa && s.id !== "timeline" && <SpinnerIcon className="h-4 w-4 text-mute print:hidden" />}
              </h2>
              {s.id === "timeline" ? (
                <div className="mt-4">
                  <Timeline voci={timeline} fonti={perN} onApri={apri} />
                </div>
              ) : (
                <div className={s.completa ? "" : "opacity-90"}>
                  <Markdown md={s.markdown} ctx={ctx} prefissoId={`sez-${s.id}`} />
                  {!s.completa && <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-link print:hidden" aria-hidden />}
                </div>
              )}
            </section>
          ))}

          {dossier && <Verifiche dossier={dossier} onApri={apri} perN={perN} />}

          {/* Indice fonti su mobile + versione stampa */}
          {fontiVive.length > 0 && (
            <section id="sez-fonti" className="mb-10 scroll-mt-20 lg:hidden print:hidden">
              <h2 className="mb-3 border-b border-hairline pb-2 text-[20px] font-semibold tracking-display-sm text-ink">Indice delle fonti</h2>
              <IndiceFonti fonti={fontiVive} attiva={aperta} onApri={apri} />
            </section>
          )}
          {dossier && (
            <section className="hidden print:block">
              <h2 className="mb-2 text-[18px] font-semibold">Indice delle fonti citate</h2>
              <ol className="space-y-1 text-[11px]">
                {dossier.fonti
                  .filter((f) => f.livello === "analizzata")
                  .map((f) => (
                    <li key={f.n}>
                      [F{f.n}] {f.titolo} ({f.anno === "0000" ? "s.d." : f.anno}) — {f.tipo} — {f.url.startsWith("http") ? f.url : `${typeof window !== "undefined" ? window.location.origin : ""}${f.url}`}
                    </li>
                  ))}
              </ol>
            </section>
          )}
        </article>

        {/* Indice fonti (desktop) */}
        <aside aria-label="Indice delle fonti" className="hidden lg:block print:hidden">
          <div className="scrollbar-thin sticky top-6 max-h-[calc(100dvh-3rem)] overflow-y-auto pr-1">
            <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-mute">Indice delle fonti</p>
            {fontiVive.length ? <IndiceFonti fonti={fontiVive} attiva={aperta} onApri={apri} /> : <p className="text-[12.5px] text-mute">In attesa dei risultati…</p>}
          </div>
        </aside>
      </div>

      {avvisi.length > 0 && (
        <details className="mt-2 rounded-ds border border-hairline bg-canvas-soft px-4 py-3 text-[12.5px] text-body print:hidden">
          <summary className="cursor-pointer font-medium text-ink">Note tecniche della generazione ({avvisi.length})</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {avvisi.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </details>
      )}

      <FonteDrawer fonte={fonteAperta} re={re} query={argomento} onChiudi={chiudi} onNaviga={naviga} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sotto-componenti                                                            */
/* -------------------------------------------------------------------------- */

function BarraArgomento({
  input,
  setInput,
  onSubmit,
  inCorso,
}: {
  input: string;
  setInput: (v: string) => void;
  onSubmit: (e: FormEvent) => void;
  inCorso: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    try {
      if (window.matchMedia("(pointer: fine)").matches) ref.current?.focus();
    } catch {
      /* niente focus automatico */
    }
  }, []);
  return (
    <form onSubmit={onSubmit} className="group relative mx-auto mt-8 w-full max-w-2xl">
      <div className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-mute group-focus-within:text-ink">
        <SearchIcon className="h-5 w-5" />
      </div>
      <input
        ref={ref}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        maxLength={120}
        enterKeyHint="go"
        placeholder="Argomento da studiare (es. volture, categoria F/3)…"
        aria-label="Argomento da studiare"
        className="h-14 w-full rounded-ds border border-hairline bg-canvas pl-12 pr-32 text-base tracking-[-0.01em] text-ink shadow-ds outline-none transition placeholder:text-mute focus:border-link focus:shadow-focus"
      />
      <button
        type="submit"
        disabled={inCorso || input.trim().length < 2}
        className="absolute right-2 top-1/2 h-10 -translate-y-1/2 rounded-[6px] bg-ink px-4 text-[13.5px] font-medium text-canvas transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Genera dossier
      </button>
    </form>
  );
}

function AzioneBtn({ children, onClick, disabled, primario }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; primario?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-ds px-3 py-2 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
        primario ? "bg-ink text-canvas hover:opacity-90" : "border border-hairline bg-canvas text-ink hover:bg-canvas-soft"
      }`}
    >
      {children}
    </button>
  );
}

function TocLista({
  toc,
  attiva,
  onVai,
}: {
  toc: Array<{ id: string; titolo: string; sotto: Array<{ id: string; titolo: string }> }>;
  attiva: string;
  onVai: (id: string) => void;
}) {
  return (
    <ul className="space-y-0.5">
      {toc.map((t) => (
        <li key={t.id}>
          <button
            onClick={() => onVai(t.id)}
            className={`block w-full rounded-md px-2 py-1.5 text-left text-[13px] leading-snug transition ${
              attiva === t.id ? "bg-canvas font-medium text-ink shadow-ds ring-1 ring-hairline" : "text-body hover:text-ink"
            }`}
          >
            {t.titolo}
          </button>
          {t.sotto.length > 0 && (
            <ul className="ml-2 border-l border-hairline pl-2">
              {t.sotto.map((s) => (
                <li key={s.id}>
                  <button onClick={() => onVai(s.id)} className="block w-full py-1 text-left font-mono text-[11.5px] text-mute hover:text-ink">
                    {s.titolo}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

function Riepilogo({
  statistiche,
  concetti,
  dossier,
}: {
  statistiche: Partial<StatisticheDossier>;
  concetti: ConcettoEspanso[];
  dossier: Dossier | null;
}) {
  const [aperto, setAperto] = useState(false);
  const tipi = Object.entries(statistiche.perTipo ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <section className="mt-4 rounded-ds-lg border border-hairline bg-canvas p-4 shadow-ds print:border-0 print:p-0 print:shadow-none">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <p className="text-[14px] text-body">
          <span className="font-mono text-[20px] font-semibold tabular-nums text-ink">{statistiche.trovate ?? 0}</span> fonti trovate nel DB
          {statistiche.daAnno && (
            <span className="text-mute">
              {" "}
              ({statistiche.daAnno}–{statistiche.aAnno})
            </span>
          )}
        </p>
        <p className="text-[13px] text-body">
          <span className="font-medium text-ink">{statistiche.analizzate ?? 0}</span> analizzate in dettaglio ·{" "}
          <span className="font-medium text-ink">{statistiche.menzioni ?? 0}</span> menzioni
        </p>
        {dossier && (
          <p className="font-mono text-[11.5px] text-mute">
            {Math.round(dossier.statistiche.durataMs / 1000)} s · {dossier.statistiche.chiamateAi} chiamate AI
          </p>
        )}
      </div>
      {tipi.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tipi.slice(0, 10).map(([t, n]) => (
            <span key={t} className="rounded-full border border-hairline bg-canvas-soft px-2 py-0.5 text-[11.5px] text-body">
              {t} <span className="font-mono text-mute">{n}</span>
            </span>
          ))}
        </div>
      )}
      {concetti.length > 0 && (
        <div className="mt-3 border-t border-hairline pt-3 print:hidden">
          <button onClick={() => setAperto((v) => !v)} aria-expanded={aperto} className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink">
            <ChevronIcon className={`h-3.5 w-3.5 transition-transform ${aperto ? "rotate-90" : ""}`} />
            Termini cercati ({concetti.length}): espansione su radici, sinonimi e diciture correlate
          </button>
          {aperto && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {concetti.map((c) => (
                <li
                  key={c.etichetta + c.espressione}
                  title={`${c.espressione} · origine: ${c.origine}`}
                  className={`rounded-full border px-2 py-0.5 text-[12px] ${c.documenti ? "border-hairline bg-canvas text-body" : "border-dashed border-hairline text-mute"}`}
                >
                  {c.etichetta} <span className="font-mono text-[10.5px] text-mute">{c.documenti}</span>
                  {c.origine === "ai" && <span className="ml-1 font-mono text-[9.5px] text-link">AI</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function Verifiche({ dossier, onApri, perN }: { dossier: Dossier; onApri: (n: number, el: HTMLElement) => void; perN: Map<number, FonteStudio> }) {
  const v = dossier.verifiche;
  return (
    <section className="mb-10 rounded-ds-lg border border-hairline bg-canvas-soft p-4 text-[13px] text-body">
      <h2 className="mb-2 font-mono text-[11.5px] uppercase tracking-[0.14em] text-mute">Controlli anti-allucinazione</h2>
      <ul className="space-y-1">
        <li>
          ✓ {v.citazioniValide} citazioni ancorate a fonti del database
          {v.citazioniRimosse > 0 && <span className="text-mute"> · {v.citazioniRimosse} citazioni non valide rimosse automaticamente</span>}
        </li>
        {v.riferimentiNonVerificati.length > 0 ? (
          <li className="text-[#9a4a07] dark:text-[#f5b86a]">
            ⚠ {v.riferimentiNonVerificati.length} riferimenti normativi nel testo non compaiono negli estratti (evidenziati nel testo): {v.riferimentiNonVerificati.join(" · ")}
          </li>
        ) : (
          <li>✓ Tutti i riferimenti normativi del testo compaiono negli estratti delle fonti</li>
        )}
        {v.fontiNonCitate.length > 0 && (
          <li className="text-mute">
            {v.fontiNonCitate.length} fonti analizzate non citate nel testo, comunque presenti in timeline e indice:{" "}
            {v.fontiNonCitate.slice(0, 20).map((n) => (
              <button key={n} onClick={(e) => onApri(n, e.currentTarget)} className="mr-1 font-mono text-[11px] text-link hover:underline">
                F{n}
              </button>
            ))}
            {v.fontiNonCitate.length > 20 && "…"}
          </li>
        )}
        {dossier.lacune.length > 0 && (
          <li className="text-mute">
            {dossier.lacune.length} norme richiamate dalle fonti ma assenti dal database (vedi “Norme superate, lacune e avvertenze”).
          </li>
        )}
      </ul>
      {perN.size > 0 && <p className="mt-2 font-mono text-[10.5px] text-mute">Modello: {dossier.statistiche.modello}</p>}
    </section>
  );
}
