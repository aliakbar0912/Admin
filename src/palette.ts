// Matching for the command palette. Kept free of React so it can be unit tested directly.
export interface PaletteItem {
  id: string;
  label: string;
  group: string;
  icon: string;
  /** Extra words that should find this item (page ids, synonyms). */
  keywords?: string;
}

export const PALETTE_LIMIT = 12;

/**
 * Ranks items against the typed query: exact label, label prefix, word prefix, label substring, then any field
 * substring. Ties keep the original order, so the list is stable while typing. An empty query shows everything.
 */
export function matchItems(items: PaletteItem[], query: string, limit = PALETTE_LIMIT): PaletteItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items.slice(0, limit);
  const scored: { item: PaletteItem; score: number; order: number }[] = [];
  items.forEach((item, order) => {
    const label = item.label.toLowerCase();
    const hay = `${label} ${item.group.toLowerCase()} ${(item.keywords ?? '').toLowerCase()}`;
    let score = -1;
    if (label === q) score = 100;
    else if (label.startsWith(q)) score = 80;
    else if (label.split(/\s+/).some((w) => w.startsWith(q))) score = 60;
    else if (label.includes(q)) score = 40;
    else if (hay.includes(q)) score = 20;
    if (score >= 0) scored.push({ item, score, order });
  });
  return scored
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map((s) => s.item);
}
