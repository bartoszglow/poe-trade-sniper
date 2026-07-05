import type { DealBaseline, DealWatchState } from '@poe-sniper/shared';
import { unitToExalted } from '../market-data/currency-rates.js';

/**
 * Pure trade2-query surgery for deal mode (plan 41). The query JSON is owned by
 * GGG and treated as opaque everywhere else; the ONLY shape assumed here is the
 * evidenced filter envelope (api-notes 2026-07-05 + apps/web/src/lib/query-criteria.ts):
 *
 *   { filters: { trade_filters: { filters: { price: {min?, max?, option?} } } }, status, ... }
 *
 * Every function is non-mutating: callers hold the input as persisted state.
 */

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneQuery<Shape>(query: Shape): Shape {
  return JSON.parse(JSON.stringify(query)) as Shape;
}

/** The `filters.trade_filters.filters.price` node, or null when absent. */
function readPriceFilter(query: unknown): unknown {
  if (!isRecord(query)) return null;
  const filterGroups = query['filters'];
  if (!isRecord(filterGroups)) return null;
  const tradeFilters = filterGroups['trade_filters'];
  if (!isRecord(tradeFilters)) return null;
  const tradeFilterEntries = tradeFilters['filters'];
  if (!isRecord(tradeFilterEntries)) return null;
  return tradeFilterEntries['price'] ?? null;
}

/**
 * Split a stored query into the price-free item DEFINITION plus the original
 * price filter (snapshotted for restore-on-disable, R5). Empty `trade_filters`
 * husks left by the removal are dropped so the definition round-trips cleanly.
 */
export function stripPriceFilter(query: unknown): {
  definition: unknown;
  originalPriceFilter: unknown;
} {
  const originalPriceFilter = readPriceFilter(query);
  if (originalPriceFilter === null || !isRecord(query)) {
    return { definition: query, originalPriceFilter: null };
  }
  const definition = cloneQuery(query);
  const filterGroups = definition['filters'] as JsonRecord;
  const tradeFilters = filterGroups['trade_filters'] as JsonRecord;
  const tradeFilterEntries = tradeFilters['filters'] as JsonRecord;
  delete tradeFilterEntries['price'];
  if (Object.keys(tradeFilterEntries).length === 0) delete filterGroups['trade_filters'];
  if (Object.keys(filterGroups).length === 0) delete definition['filters'];
  return { definition, originalPriceFilter };
}

/**
 * The watched deal query: definition + the auto-cap. The cap deliberately has
 * NO currency `option` — an option-less price filter is value-converted by GGG
 * across all listing currencies in the league base (exalted), while an explicit
 * option matches that single currency literally (D-dw-6, api-notes 2026-07-05).
 */
export function withPriceCap(definition: unknown, capExalted: number): unknown {
  const base = isRecord(definition) ? cloneQuery(definition) : {};
  const filterGroups = isRecord(base['filters']) ? base['filters'] : {};
  const tradeFilters = isRecord(filterGroups['trade_filters']) ? filterGroups['trade_filters'] : {};
  const tradeFilterEntries = isRecord(tradeFilters['filters']) ? tradeFilters['filters'] : {};
  tradeFilterEntries['price'] = { max: capExalted };
  tradeFilters['filters'] = tradeFilterEntries;
  if (!('disabled' in tradeFilters)) tradeFilters['disabled'] = false;
  filterGroups['trade_filters'] = tradeFilters;
  base['filters'] = filterGroups;
  return base;
}

/**
 * The baseline query: the definition with online-only status and no price
 * filter, so the sample is the whole live market for the item. `online` is
 * accepted live but its strict seller filtering is still TODO(verify) (P0.9).
 */
export function baselineQuery(definition: unknown): unknown {
  const base = isRecord(definition) ? cloneQuery(definition) : {};
  base['status'] = { option: 'online' };
  return base;
}

/** The pre-deal query for disable: definition + the snapshotted price filter. */
export function restoreQuery(definition: unknown, originalPriceFilter: unknown): unknown {
  if (originalPriceFilter === null)
    return isRecord(definition) ? cloneQuery(definition) : definition;
  const base = isRecord(definition) ? cloneQuery(definition) : {};
  const filterGroups = isRecord(base['filters']) ? base['filters'] : {};
  const tradeFilters = isRecord(filterGroups['trade_filters']) ? filterGroups['trade_filters'] : {};
  const tradeFilterEntries = isRecord(tradeFilters['filters']) ? tradeFilters['filters'] : {};
  tradeFilterEntries['price'] = originalPriceFilter;
  tradeFilters['filters'] = tradeFilterEntries;
  if (!('disabled' in tradeFilters)) tradeFilters['disabled'] = false;
  filterGroups['trade_filters'] = tradeFilters;
  base['filters'] = filterGroups;
  return base;
}

/**
 * The alert cutoff in exalted (R1): listings at or under it are deals. Percent
 * mode needs no rates; absolute mode converts the unit threshold via the
 * divine rate SNAPSHOT (sync — this feeds the hot-path decorator). Null when
 * the math is impossible (no baseline, or divine threshold without a rate).
 */
export function computeCutoffExalted(
  state: Pick<DealWatchState, 'mode' | 'thresholdValue' | 'unit'> & {
    baseline: DealBaseline | null;
  },
  divinePriceExaltedSnapshot: number | null,
): number | null {
  if (state.baseline === null) return null;
  const baselineExalted = state.baseline.amountExalted;
  if (state.mode === 'percent') {
    return baselineExalted * (1 - state.thresholdValue / 100);
  }
  const thresholdExalted = unitToExalted(
    state.thresholdValue,
    state.unit,
    divinePriceExaltedSnapshot,
  );
  return thresholdExalted === null ? null : baselineExalted - thresholdExalted;
}
