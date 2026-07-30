/**
 * Rende lo snippet gia' sanificato lato server (contiene SOLO <mark>).
 * L'HTML e' stato escapato in `snippetToSafeHtml`, quindi dangerouslySetInnerHTML
 * qui e' sicuro: l'unico tag possibile e' <mark>.
 */
export function HighlightedSnippet({ html }: { html: string }) {
  if (!html.trim()) {
    return (
      <p className="text-sm italic text-zinc-400 dark:text-zinc-500">
        Nessuna anteprima testuale disponibile per questo documento.
      </p>
    );
  }
  return (
    <p
      className="text-[13.5px] leading-relaxed text-zinc-600 dark:text-zinc-300"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
