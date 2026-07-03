import { describe, expect, it } from 'vitest';
import type { PriceCheckFilter } from '@poe-sniper/shared';
import type { ParsedItem } from './item-text-parser.js';
import type { StatMatch } from './stat-matcher.js';
import { buildDraft } from './price-check-draft.js';
import { buildQueryFromFilters } from './query-from-filters.js';

const RARE: ParsedItem = {
  itemClass: 'Body Armours',
  rarity: 'Rare',
  name: 'Corpse Shell',
  baseType: 'Advanced Dualstring Armour',
  itemLevel: 81,
  quality: 20,
  corrupted: true,
  unidentified: false,
  modLines: [],
};
const LIFE: StatMatch = {
  statId: 'explicit.stat_life',
  text: '+# to maximum Life',
  type: 'explicit',
  values: [25],
};

type RareQuery = {
  type?: string;
  name?: string;
  stats: Array<{ filters: Array<{ id: string; value?: { min?: number; max?: number } }> }>;
  filters?: { misc_filters: { filters: Record<string, { min?: number; option?: string }> } };
};

describe('buildDraft', () => {
  it('base type ON, item attrs opt-in OFF, stat ON with a floored default min', () => {
    const draft = buildDraft({
      item: RARE,
      matched: [LIFE],
      unmatched: ['some unmatched line'],
      league: 'Runes of Aldur',
      baseType: 'Advanced Dualstring Armour',
    });
    expect(draft.league).toBe('Runes of Aldur');
    expect(draft.unmatched).toEqual(['some unmatched line']);
    expect(draft.fixedValue).toBe(false);
    const base = draft.filters.find((f) => f.kind === 'attr' && f.attr === 'baseType');
    expect(base?.enabled).toBe(true);
    const ilvl = draft.filters.find((f) => f.kind === 'attr' && f.attr === 'itemLevel');
    expect(ilvl?.enabled).toBe(false);
    const stat = draft.filters.find((f) => f.kind === 'stat');
    expect(stat).toMatchObject({ statId: 'explicit.stat_life', enabled: true, min: 22 });
  });

  it('flags fixed-value items (currency)', () => {
    const draft = buildDraft({
      item: {
        ...RARE,
        rarity: 'Currency',
        itemClass: 'Stackable Currency',
        name: 'Divine Orb',
        baseType: 'Divine Orb',
        itemLevel: null,
        quality: null,
        corrupted: false,
      },
      matched: [],
      unmatched: [],
      league: 'X',
      baseType: null,
    });
    expect(draft.fixedValue).toBe(true);
  });
});

describe('buildQueryFromFilters', () => {
  function toggle(
    filters: PriceCheckFilter[],
    fn: (filter: PriceCheckFilter) => PriceCheckFilter,
  ): PriceCheckFilter[] {
    return filters.map(fn);
  }

  it('serializes only ENABLED filters — a disabled stat is dropped, an enabled attr added', () => {
    const draft = buildDraft({
      item: RARE,
      matched: [LIFE],
      unmatched: [],
      league: 'X',
      baseType: 'Advanced Dualstring Armour',
    });
    const filters = toggle(draft.filters, (filter) => {
      if (filter.kind === 'attr' && filter.attr === 'itemLevel')
        return { ...filter, enabled: true };
      if (filter.kind === 'stat') return { ...filter, enabled: false };
      return filter;
    });
    const query = buildQueryFromFilters({ filters, rarity: 'Rare', name: 'Corpse Shell' })
      .query as RareQuery;
    expect(query.type).toBe('Advanced Dualstring Armour');
    expect(query.stats[0]?.filters).toEqual([]);
    expect(query.filters?.misc_filters.filters['ilvl']).toEqual({ min: 81 });
  });

  it('applies the operator-edited stat min/max', () => {
    const draft = buildDraft({
      item: RARE,
      matched: [LIFE],
      unmatched: [],
      league: 'X',
      baseType: null,
    });
    const filters = toggle(draft.filters, (filter) =>
      filter.kind === 'stat' ? { ...filter, min: 50, max: 100 } : filter,
    );
    const query = buildQueryFromFilters({ filters, rarity: 'Rare', name: null }).query as RareQuery;
    expect(query.stats[0]?.filters[0]).toEqual({
      id: 'explicit.stat_life',
      value: { min: 50, max: 100 },
    });
  });

  it('uniques query by name + base, ignoring stats', () => {
    const draft = buildDraft({
      item: { ...RARE, rarity: 'Unique', name: 'Andvarius', baseType: 'Gold Ring' },
      matched: [LIFE],
      unmatched: [],
      league: 'X',
      baseType: 'Gold Ring',
    });
    const query = buildQueryFromFilters({
      filters: draft.filters,
      rarity: 'Unique',
      name: 'Andvarius',
    }).query as RareQuery;
    expect(query.name).toBe('Andvarius');
    expect(query.type).toBe('Gold Ring');
    expect(query.stats).toEqual([]);
  });
});
