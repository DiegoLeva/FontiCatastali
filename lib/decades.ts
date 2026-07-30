import type { DecadeFacet, FolderGroup, SearchResponse } from "./types";

/** Decennio di un anno: "2019" -> "2010", "0000" -> "0000". */
export function fileDecade(anno: string): string {
  return anno === "0000" ? "0000" : `${anno.slice(0, 3)}0`;
}

function decadeLabel(key: string): string {
  return key === "0000" ? "Senza data" : `Anni ${key}`;
}

/** Faccette di decennio dai risultati, con conteggi. "Senza data" in fondo. */
export function computeDecades(groups: FolderGroup[]): DecadeFacet[] {
  const counts = new Map<string, number>();
  for (const g of groups) {
    for (const f of g.files) {
      const k = fileDecade(f.anno);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([key, count]) => ({ key, label: decadeLabel(key), count }))
    .sort((a, b) => {
      if (a.key === "0000") return 1;
      if (b.key === "0000") return -1;
      return b.key.localeCompare(a.key); // decenni decrescenti
    });
}

/** Filtra la risposta per i decenni attivi (vuoto = tutti), ricalcolando conteggi. */
export function filterResponse(
  data: SearchResponse,
  active: string[]
): SearchResponse {
  if (active.length === 0) return data;
  const set = new Set(active);
  const groups: FolderGroup[] = [];
  for (const g of data.groups) {
    const files = g.files.filter((f) => set.has(fileDecade(f.anno)));
    if (files.length) groups.push({ ...g, count: files.length, files });
  }
  const total = groups.reduce((s, g) => s + g.count, 0);
  return { ...data, groups, total };
}
