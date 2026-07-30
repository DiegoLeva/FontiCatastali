/** Skeleton loader per lo stato di caricamento (stile "shimmer"). */

function Bar({ className = "" }: { className?: string }) {
  return (
    <div
      className={`relative overflow-hidden rounded-md bg-zinc-200/70 dark:bg-zinc-800/70 ${className}`}
    >
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/40 to-transparent dark:via-white/10" />
    </div>
  );
}

export function ResultsSkeleton() {
  return (
    <div className="space-y-3" aria-hidden>
      {[0, 1, 2].map((g) => (
        <div
          key={g}
          className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="flex items-center gap-3">
            <Bar className="h-5 w-5 rounded" />
            <Bar className="h-4 w-40" />
            <Bar className="ml-auto h-5 w-10 rounded-full" />
          </div>
          <div className="mt-4 space-y-4 pl-8">
            {[0, 1].map((f) => (
              <div key={f} className="space-y-2">
                <Bar className="h-4 w-2/3" />
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
