/**
 * Builds a trade2 search query from a parsed+matched item (#37). PURE.
 *
 * Two shapes:
 *  - UNIQUE → match by name + base type, ignore rolls (variants priced together).
 *  - RARE/MAGIC → match by base type + each matched stat as a `min` filter
 *    (roll − tolerance), so comparable-or-better items surface, cheapest first.
 * Corrupted state and a minimum item level are carried as misc filters.
 */
import type { StatMatch } from './stat-matcher.js';

export interface QueryBuildInput {
  rarity: string | null;
  name: string | null;
  baseType: string | null;
  itemLevel: number | null;
  corrupted: boolean;
  matchedStats: StatMatch[];
}

export interface BuiltQuery {
  query: unknown;
  sort: { price: 'asc' };
}

/** Widen each roll DOWN by this fraction so equal-or-better items match. */
const ROLL_TOLERANCE = 0.1;

function statFilter(match: StatMatch): { id: string; value?: { min: number } } {
  if (match.values.length === 0) return { id: match.statId };
  const roll = Math.min(...match.values);
  // Floor a positive roll to (roll − 10%); leave non-positive rolls unbounded.
  const min = roll > 0 ? Math.floor(roll * (1 - ROLL_TOLERANCE)) : roll;
  return { id: match.statId, value: { min } };
}

export function buildQuery(input: QueryBuildInput): BuiltQuery {
  const isUnique = input.rarity?.toLowerCase() === 'unique';

  const typeFilters: Record<string, unknown> = {};
  const miscFilters: Record<string, { min?: number; option?: string }> = {};
  if (input.itemLevel !== null) miscFilters['ilvl'] = { min: input.itemLevel };
  if (input.corrupted) miscFilters['corrupted'] = { option: 'true' };

  const query: Record<string, unknown> = {
    status: { option: 'online' },
    stats: [],
  };

  if (isUnique && input.name) {
    query['name'] = input.name;
    if (input.baseType) query['type'] = input.baseType;
  } else {
    if (input.baseType) query['type'] = input.baseType;
    query['stats'] = [{ type: 'and', filters: input.matchedStats.map(statFilter) }];
  }

  const filters: Record<string, unknown> = {};
  if (Object.keys(typeFilters).length > 0) filters['type_filters'] = { filters: typeFilters };
  if (Object.keys(miscFilters).length > 0) filters['misc_filters'] = { filters: miscFilters };
  if (Object.keys(filters).length > 0) query['filters'] = filters;

  return { query, sort: { price: 'asc' } };
}

/** Fixed-value items priced by an aggregator, not a listings search. */
export function isFixedValueItem(rarity: string | null, itemClass: string | null): boolean {
  const rarityLower = rarity?.toLowerCase();
  if (rarityLower === 'currency' || rarityLower === 'unique') return true;
  const classLower = itemClass?.toLowerCase() ?? '';
  return (
    classLower.includes('currency') ||
    classLower.includes('rune') ||
    classLower.includes('essence') ||
    classLower.includes('omen') ||
    classLower.includes('catalyst') ||
    classLower.includes('distilled')
  );
}
