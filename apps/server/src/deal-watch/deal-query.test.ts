import { describe, expect, it } from 'vitest';
import {
  baselineQuery,
  computeCutoffExalted,
  restoreQuery,
  stripPriceFilter,
  withPriceCap,
} from './deal-query.js';

/** The evidenced resolved-query shape (a real capped gem search, trimmed). */
const cappedQuery = {
  type: 'Barrage',
  status: { option: 'securable' },
  filters: {
    misc_filters: { filters: { gem_level: { max: null, min: 21 } }, disabled: false },
    trade_filters: { filters: { price: { max: 5, option: 'divine' } }, disabled: false },
  },
};

const uncappedQuery = {
  type: 'Barrage',
  status: { option: 'securable' },
  filters: {
    misc_filters: { filters: { gem_level: { max: null, min: 21 } }, disabled: false },
  },
};

describe('stripPriceFilter', () => {
  it('splits the definition from the original price filter without mutating input', () => {
    const frozen: unknown = JSON.parse(JSON.stringify(cappedQuery));
    const { definition, originalPriceFilter } = stripPriceFilter(cappedQuery);
    expect(originalPriceFilter).toEqual({ max: 5, option: 'divine' });
    expect(cappedQuery).toEqual(frozen);
    const definitionRecord = definition as typeof cappedQuery;
    expect(definitionRecord.filters).not.toHaveProperty('trade_filters');
    expect(definitionRecord.filters.misc_filters).toEqual(cappedQuery.filters.misc_filters);
  });

  it('drops an empty trade_filters husk but keeps siblings', () => {
    const { definition } = stripPriceFilter(cappedQuery);
    expect(Object.keys((definition as { filters: object }).filters)).toEqual(['misc_filters']);
  });

  it('is a no-op split for a query without a price filter', () => {
    const { definition, originalPriceFilter } = stripPriceFilter(uncappedQuery);
    expect(originalPriceFilter).toBeNull();
    expect(definition).toEqual(uncappedQuery);
  });

  it('keeps other trade_filters entries when only price is removed', () => {
    const withSaleType = {
      ...cappedQuery,
      filters: {
        ...cappedQuery.filters,
        trade_filters: {
          filters: { price: { max: 5 }, sale_type: { option: 'priced' } },
          disabled: false,
        },
      },
    };
    const { definition } = stripPriceFilter(withSaleType);
    const tradeFilters = (definition as { filters: { trade_filters: { filters: object } } }).filters
      .trade_filters.filters;
    expect(tradeFilters).toEqual({ sale_type: { option: 'priced' } });
  });
});

describe('withPriceCap', () => {
  it('sets an option-LESS price cap (D-dw-6: no option = value-converted match)', () => {
    const { definition } = stripPriceFilter(cappedQuery);
    const capped = withPriceCap(definition, 516) as typeof cappedQuery;
    expect(capped.filters.trade_filters.filters).toEqual({ price: { max: 516 } });
    expect(capped.filters.misc_filters).toEqual(cappedQuery.filters.misc_filters);
  });

  it('watches the instant-buyout market only (D-dw-13), whatever the definition status', () => {
    const anyStatusDefinition = { ...uncappedQuery, status: { option: 'any' } };
    const capped = withPriceCap(anyStatusDefinition, 516) as typeof cappedQuery;
    expect(capped.status).toEqual({ option: 'securable' });
  });

  it('builds the filter envelope from scratch for a bare definition', () => {
    const capped = withPriceCap({ type: 'Barrage' }, 100) as {
      filters: { trade_filters: { filters: { price: { max: number } }; disabled: boolean } };
    };
    expect(capped.filters.trade_filters.filters.price.max).toBe(100);
    expect(capped.filters.trade_filters.disabled).toBe(false);
  });
});

describe('baselineQuery', () => {
  it('samples the instant-buyout market only and never carries a price filter', () => {
    // D-dw-13: `online` starved the sample (2 vs 56 on identical constraints,
    // api-notes 2026-07-05), and inheriting an 'any' status would sample the
    // manipulation-prone non-instant listings — securable is forced.
    const { definition } = stripPriceFilter(cappedQuery);
    const baseline = baselineQuery(definition) as typeof cappedQuery;
    expect(baseline.status).toEqual({ option: 'securable' });
    expect(baseline.filters).not.toHaveProperty('trade_filters');
  });

  it('forces securable even when the definition status is broader', () => {
    const anyStatusDefinition = { ...uncappedQuery, status: { option: 'any' } };
    const baseline = baselineQuery(anyStatusDefinition) as typeof cappedQuery;
    expect(baseline.status).toEqual({ option: 'securable' });
  });
});

describe('restoreQuery', () => {
  it('round-trips the original query through strip + restore', () => {
    const { definition, originalPriceFilter } = stripPriceFilter(cappedQuery);
    expect(restoreQuery(definition, originalPriceFilter)).toEqual(cappedQuery);
  });

  it('returns the bare definition when there was no original price filter', () => {
    const { definition, originalPriceFilter } = stripPriceFilter(uncappedQuery);
    expect(restoreQuery(definition, originalPriceFilter)).toEqual(uncappedQuery);
  });
});

describe('computeCutoffExalted', () => {
  const baseline = {
    amountExalted: 1000,
    sampleSize: 5,
    rawLowestExalted: 900,
    computedAt: '2026-07-05T00:00:00.000Z',
    listingsSeen: 10,
  };

  it('percent mode: baseline × (1 − pct/100), no rate needed', () => {
    const cutoff = computeCutoffExalted(
      { mode: 'percent', thresholdValue: 30, unit: 'exalted', baseline },
      null,
    );
    expect(cutoff).toBe(700);
  });

  it('absolute exalted mode: baseline − threshold', () => {
    const cutoff = computeCutoffExalted(
      { mode: 'absolute', thresholdValue: 250, unit: 'exalted', baseline },
      null,
    );
    expect(cutoff).toBe(750);
  });

  it('absolute divine mode converts via the divine-rate snapshot', () => {
    const cutoff = computeCutoffExalted(
      { mode: 'absolute', thresholdValue: 1, unit: 'divine', baseline },
      714,
    );
    expect(cutoff).toBe(286);
  });

  it('absolute divine mode without a rate snapshot is null (unpriceable, never 0)', () => {
    const cutoff = computeCutoffExalted(
      { mode: 'absolute', thresholdValue: 1, unit: 'divine', baseline },
      null,
    );
    expect(cutoff).toBeNull();
  });

  it('no baseline → null', () => {
    const cutoff = computeCutoffExalted(
      { mode: 'percent', thresholdValue: 30, unit: 'exalted', baseline: null },
      714,
    );
    expect(cutoff).toBeNull();
  });
});
