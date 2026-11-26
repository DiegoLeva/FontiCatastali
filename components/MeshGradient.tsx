/**
 * Mesh gradient atmosferico (firma del design). Backdrop 2D a scala hero,
 * mai miniaturizzato. Sfuma via quando arrivano i risultati (`active=false`).
 *
 * Prestazioni: un elemento enorme con blur e animazione infinita costa GPU e
 * batteria sui telefoni. Su mobile il blur e' ridotto, l'animazione si ferma
 * con `prefers-reduced-motion` e quando il gradiente non e' visibile, e
 * `will-change` lo isola in un layer composito proprio.
 */
export function MeshGradient({ active }: { active: boolean }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute left-1/2 top-0 -z-10 h-[75vh] w-screen -translate-x-1/2 overflow-hidden transition-opacity duration-700 ease-out print:hidden ${
        active ? "opacity-100" : "opacity-0"
      }`}
    >
      <div
        className={`absolute left-1/2 top-[-15%] h-[560px] w-[min(1100px,120vw)] -translate-x-1/2 opacity-70 blur-[56px] will-change-transform motion-reduce:animate-none dark:opacity-40 sm:blur-[90px] ${
          active ? "animate-mesh-drift" : ""
        }`}
        style={{
          background: `
            radial-gradient(38% 50% at 18% 32%, #007cf0 0%, transparent 68%),
            radial-gradient(34% 46% at 55% 18%, #7928ca 0%, transparent 66%),
            radial-gradient(42% 54% at 82% 40%, #ff0080 0%, transparent 66%),
            radial-gradient(40% 52% at 38% 64%, #50e3c2 0%, transparent 66%),
            radial-gradient(34% 46% at 76% 72%, #f9cb28 0%, transparent 66%)
          `,
        }}
      />
    </div>
  );
}
