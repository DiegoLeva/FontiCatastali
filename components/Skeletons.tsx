/** Skeleton loader (shimmer) coerente col design system. */

function Bar({ className = "" }: { className?: string }) {
  return (
    <div
      className={`relative overflow-hidden rounded bg-canvas-soft-2 ${className}`}
    >
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-black/[0.04] to-transparent dark:via-white/[0.05]" />
    </div>
  );
}

export function ResultsSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      {[0, 1, 2].map((g) => (
        <div
          key={g}
          className="rounded-ds border border-hairline bg-canvas p-4 shadow-ds"
        >
          <div className="flex items-center gap-3">
            <Bar className="h-4 w-4" />
            <Bar className="h-4 w-40" />
            <Bar className="ml-auto h-5 w-16 rounded-full" />
          </div>
          <div className="mt-4 space-y-4 pl-7">
            {[0, 1].map((f) => (
              <div key={f} className="space-y-2">
                <Bar className="h-3.5 w-2/3" />
                <Bar className="h-3 w-full" />
                <Bar className="h-3 w-11/12" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
