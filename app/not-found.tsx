import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center px-6 text-center">
      <p className="font-mono text-[12px] uppercase tracking-[0.14em] text-mute">404</p>
      <h1 className="mt-3 text-[26px] font-semibold tracking-display-sm text-ink">
        Pagina non trovata
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-body">
        L&apos;indirizzo non corrisponde a nessuna pagina o documento
        dell&apos;archivio.
      </p>
      <div className="mt-6 flex gap-3">
        <Link
          href="/"
          className="rounded-ds bg-ink px-4 py-2 text-[14px] font-medium text-canvas transition hover:opacity-90"
        >
          Vai alla ricerca
        </Link>
        <Link
          href="/studio"
          className="rounded-ds border border-hairline bg-canvas px-4 py-2 text-[14px] font-medium text-ink transition hover:bg-canvas-soft"
        >
          Studio Normativo
        </Link>
      </div>
    </main>
  );
}
