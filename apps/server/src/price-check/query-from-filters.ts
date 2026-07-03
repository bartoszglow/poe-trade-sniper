/**
 * Builds a trade2 query from the operator's EDITED filter selections (#38 A). PURE.
 * The counterpart to buildQuery (which auto-derives from a fresh parse): here only
 * `enabled` filters contribute, each with the operator's own min/max. Serialization
 * is per filter kind — new kinds are additive (open/closed).
 */
import type { PriceCheckFilter, PriceCheckStatFilter } from '@poe-sniper/shared';
import type { BuiltQuery } from './query-builder.js';

function statToFilter(filter: PriceCheckStatFilter): {
  id: string;
  value?: { min?: number; max?: number };
} {
  const value: { min?: number; max?: number } = {};
  if (filter.min !== null) value.min = filter.min;
  if (filter.max !== null) value.max = filter.max;
  return Object.keys(value).length > 0 ? { id: filter.statId, value } : { id: filter.statId };
}

export function buildQueryFromFilters(options: {
  filters: PriceCheckFilter[];
  rarity: string | null;
  name: string | null;
}): BuiltQuery {
  const { filters, rarity, name } = options;
  const isUnique = rarity?.toLowerCase() === 'unique';
  const enabled = filters.filter((filter) => filter.enabled);

  const statFilters = enabled
    .filter((filter): filter is PriceCheckStatFilter => filter.kind === 'stat')
    .map(statToFilter);

  const miscFilters: Record<string, { min?: number; option?: string }> = {};
  let baseType: string | null = null;
  for (const filter of enabled) {
    if (filter.kind !== 'attr') continue;
    if (filter.attr === 'baseType' && typeof filter.value === 'string') {
      baseType = filter.value;
    } else if (filter.attr === 'itemLevel' && typeof filter.value === 'number') {
      miscFilters['ilvl'] = { min: filter.value };
    } else if (filter.attr === 'quality' && typeof filter.value === 'number') {
      miscFilters['quality'] = { min: filter.value };
    } else if (filter.attr === 'corrupted') {
      miscFilters['corrupted'] = { option: 'true' };
    }
  }

  const query: Record<string, unknown> = { status: { option: 'online' }, stats: [] };
  if (isUnique && name) {
    query['name'] = name;
    if (baseType) query['type'] = baseType;
  } else {
    if (baseType) query['type'] = baseType;
    query['stats'] = [{ type: 'and', filters: statFilters }];
  }

  const filtersBlock: Record<string, unknown> = {};
  if (Object.keys(miscFilters).length > 0) filtersBlock['misc_filters'] = { filters: miscFilters };
  if (Object.keys(filtersBlock).length > 0) query['filters'] = filtersBlock;

  return { query, sort: { price: 'asc' } };
}
