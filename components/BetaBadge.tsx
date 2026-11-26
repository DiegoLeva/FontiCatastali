/** Badge "BETA" coerente col design system (accento link-blue). */
export function BetaBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border border-link/30 bg-link-soft px-1.5 py-px font-mono text-[9.5px] font-semibold uppercase leading-[14px] tracking-[0.08em] text-link-deep dark:border-link/40 dark:bg-[rgba(0,112,243,0.18)] dark:text-[#9ecbff] ${className}`}
    >
      Beta
    </span>
  );
}
