import Link from "next/link";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { BetaBadge } from "./BetaBadge";
import { BadgeNovita } from "./watchlist/BadgeNovita";

export type Sezione = "ricerca" | "studio" | "aggiornamenti" | "documento";

export { BetaBadge };

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium tracking-[-0.01em] transition focus:outline-none focus-visible:shadow-focus ${
        active
          ? "bg-canvas text-ink shadow-ds ring-1 ring-hairline"
          : "text-mute hover:bg-canvas-soft-2 hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

/**
 * Intestazione condivisa da tutte le pagine: marchio, navigazione principale
 * (con lo Studio Normativo in BETA) e selettore del tema.
 */
export function SiteHeader({
  attiva,
  larga = false,
}: {
  attiva?: Sezione;
  /** Pagine a tre colonne (Studio) usano un contenitore piu' largo. */
  larga?: boolean;
}) {
  return (
    <header
      className={`mx-auto flex w-full items-center justify-between gap-2 print:hidden ${
        larga ? "max-w-6xl" : "max-w-3xl"
      }`}
    >
      <Link
        href="/"
        className="flex min-w-0 items-center gap-2 rounded-md text-ink focus:outline-none focus-visible:shadow-focus"
        aria-label="FontiCatastali — torna alla ricerca"
      >
        <Logo className="h-5 w-5 shrink-0" />
        <span className="truncate font-mono text-[13px] font-medium tracking-[-0.01em] max-[370px]:hidden">
          FontiCatastali
        </span>
      </Link>

      <nav aria-label="Sezioni principali" className="flex items-center gap-1">
        <NavLink href="/" active={attiva === "ricerca"}>
          Ricerca
        </NavLink>
        <NavLink href="/studio" active={attiva === "studio"}>
          <span className="hidden sm:inline">Studio Normativo</span>
          <span className="sm:hidden">Studio</span>
          <BetaBadge />
        </NavLink>
        <BadgeNovita />
        <span className="ml-1">
          <ThemeToggle />
        </span>
      </nav>
    </header>
  );
}
