/**
 * Stable React keys for search rows (plan 42 review). `search.id` is the GGG
 * slug and CHANGES under the operator: a deal re-derive swaps it hourly, deal
 * enable/disable flips the old `watchId ?? id` key, and a settings re-point
 * replaces it — every flip remounted the row and snapped its open panel shut.
 * `addedAt` is stable for the row's whole lifetime (carried through every
 * id-swap transaction server-side), so it is the key — with a deterministic
 * tie-break for the pathological case of duplicate timestamps (import
 * artifacts), which falls back to the old volatile scheme for those rows only.
 */

export interface RowKeySearch {
  id: string;
  addedAt: string;
  dealWatch: { watchId: string } | null;
}

/** addedAt values that appear on MORE than one row (active + archived alike). */
export function duplicatedAddedAts(searches: ReadonlyArray<{ addedAt: string }>): Set<string> {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const search of searches) {
    if (seen.has(search.addedAt)) duplicated.add(search.addedAt);
    else seen.add(search.addedAt);
  }
  return duplicated;
}

export function stableRowKey(search: RowKeySearch, duplicated: ReadonlySet<string>): string {
  if (!duplicated.has(search.addedAt)) return search.addedAt;
  return `${search.addedAt}:${search.dealWatch?.watchId ?? search.id}`;
}
