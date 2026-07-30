/** Marchio: lente d'ingrandimento su griglia catastale. Usa currentColor. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      fill="none"
      aria-hidden
      xmlns="http://www.w3.org/2000/svg"
    >
      <g stroke="currentColor" strokeWidth="1.3" opacity="0.5">
        <line x1="13.5" y1="8.5" x2="13.5" y2="18.5" />
        <line x1="8.5" y1="13.5" x2="18.5" y2="13.5" />
      </g>
      <g stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <circle cx="13.5" cy="13.5" r="7" />
        <line x1="18.6" y1="18.6" x2="25" y2="25" />
      </g>
    </svg>
  );
}
