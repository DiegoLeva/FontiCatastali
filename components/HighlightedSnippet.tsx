/**
 * Rende lo snippet gia' sanificato lato server (contiene SOLO <mark>).
 * L'HTML e' stato escapato in `snippetToSafeHtml`, quindi dangerouslySetInnerHTML
 * qui e' sicuro: l'unico tag possibile e' <mark>.
 */
export function HighlightedSnippet({ html }: { html: string }) {
  if (!html.trim()) {
    return (
      <p className="text-[13px] italic text-mute">
        Nessuna anteprima testuale disponibile per questo documento.
      </p>
    );
  }
  return (
    <p
      className="text-[13px] leading-relaxed text-body"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
