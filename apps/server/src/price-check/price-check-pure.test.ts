import { describe, expect, it } from 'vitest';
import { parseItemText } from './item-text-parser.js';
import { compileStats, matchModLine, type StatEntry } from './stat-matcher.js';
import { buildQuery, isFixedValueItem } from './query-builder.js';

const RARE_ITEM = [
  'Item Class: Body Armours',
  'Rarity: Rare',
  'Corpse Shell',
  'Advanced Dualstring Armour',
  '--------',
  'Quality: +20% (augmented)',
  'Energy Shield: 124 (augmented)',
  '--------',
  'Requirements:',
  'Level: 65',
  'Int: 157',
  '--------',
  'Sockets: S S ',
  '--------',
  'Item Level: 81',
  '--------',
  '+25 to maximum Life',
  '+42% to Fire Resistance',
  '12% increased Rarity of Items found (implicit)',
  'Corrupted',
].join('\n');

const UNIQUE_ITEM = [
  'Item Class: Rings',
  'Rarity: Unique',
  'Andvarius',
  'Gold Ring',
  '--------',
  'Item Level: 60',
  '--------',
  '+#% increased Rarity of Items found',
].join('\n');

describe('parseItemText', () => {
  it('parses a rare item: header, ilvl, quality, corrupted, mod lines with domains', () => {
    const item = parseItemText(RARE_ITEM);
    expect(item.itemClass).toBe('Body Armours');
    expect(item.rarity).toBe('Rare');
    expect(item.name).toBe('Corpse Shell');
    expect(item.baseType).toBe('Advanced Dualstring Armour');
    expect(item.itemLevel).toBe(81);
    expect(item.quality).toBe(20);
    expect(item.corrupted).toBe(true);
    expect(item.modLines).toEqual([
      { text: '+25 to maximum Life', domain: 'explicit' },
      { text: '+42% to Fire Resistance', domain: 'explicit' },
      { text: '12% increased Rarity of Items found', domain: 'implicit' },
    ]);
    // Requirements / Sockets / Level lines never leak into modLines.
    expect(item.modLines.some((mod) => mod.text.includes('Int'))).toBe(false);
  });

  it('treats a Normal item base type as both name and baseType', () => {
    const item = parseItemText(
      [
        'Item Class: Currency',
        'Rarity: Currency',
        'Divine Orb',
        '--------',
        'Stack Size: 3/10',
      ].join('\n'),
    );
    expect(item.name).toBe('Divine Orb');
    expect(item.baseType).toBe('Divine Orb');
    expect(item.modLines).toEqual([]);
  });
});

const STATS: StatEntry[] = [
  { id: 'explicit.stat_life', text: '+# to maximum Life', type: 'explicit' },
  { id: 'explicit.stat_fireres', text: '+#% to Fire Resistance', type: 'explicit' },
  { id: 'implicit.stat_rarity', text: '#% increased Rarity of Items found', type: 'implicit' },
  { id: 'explicit.stat_rarity', text: '#% increased Rarity of Items found', type: 'explicit' },
];

describe('compileStats + matchModLine', () => {
  const compiled = compileStats(STATS);

  it('matches a roll and extracts the value', () => {
    const match = matchModLine(compiled, { text: '+25 to maximum Life', domain: 'explicit' });
    expect(match).toEqual({
      statId: 'explicit.stat_life',
      text: '+# to maximum Life',
      values: [25],
    });
  });

  it('prefers the stat type matching the mod domain (implicit vs explicit share text)', () => {
    const asImplicit = matchModLine(compiled, {
      text: '12% increased Rarity of Items found',
      domain: 'implicit',
    });
    expect(asImplicit?.statId).toBe('implicit.stat_rarity');
    const asExplicit = matchModLine(compiled, {
      text: '30% increased Rarity of Items found',
      domain: 'explicit',
    });
    expect(asExplicit?.statId).toBe('explicit.stat_rarity');
  });

  it('returns null for an unmatched line', () => {
    expect(
      matchModLine(compiled, { text: 'Some unknown mystery mod', domain: 'explicit' }),
    ).toBeNull();
  });
});

describe('buildQuery', () => {
  it('rares: base type + stat mins floored to roll − 10%, misc filters', () => {
    const built = buildQuery({
      rarity: 'Rare',
      name: 'Corpse Shell',
      baseType: 'Advanced Dualstring Armour',
      itemLevel: 81,
      quality: 20,
      corrupted: true,
      matchedStats: [{ statId: 'explicit.stat_life', text: '+# to maximum Life', values: [25] }],
    });
    const query = built.query as {
      type: string;
      stats: Array<{ filters: unknown[] }>;
      filters: { misc_filters: { filters: unknown } };
    };
    expect(query.type).toBe('Advanced Dualstring Armour');
    expect(query.stats[0]?.filters[0]).toEqual({
      id: 'explicit.stat_life',
      value: { min: 22 }, // floor(25 * 0.9)
    });
    expect(query.filters.misc_filters.filters).toEqual({
      ilvl: { min: 81 },
      quality: { min: 20 },
      corrupted: { option: 'true' },
    });
    expect(built.sort).toEqual({ price: 'asc' });
  });

  it('uniques: matched by name + base, no stat filters', () => {
    const built = buildQuery({
      rarity: 'Unique',
      name: 'Andvarius',
      baseType: 'Gold Ring',
      itemLevel: 60,
      quality: null,
      corrupted: false,
      matchedStats: [{ statId: 'explicit.stat_rarity', text: '#% increased Rarity', values: [80] }],
    });
    const query = built.query as { name: string; type: string; stats: unknown[] };
    expect(query.name).toBe('Andvarius');
    expect(query.type).toBe('Gold Ring');
    expect(query.stats).toEqual([]);
  });
});

describe('isFixedValueItem', () => {
  it('flags currency / uniques / runes as aggregator-priced', () => {
    expect(isFixedValueItem('Currency', 'Stackable Currency')).toBe(true);
    expect(isFixedValueItem('Unique', 'Rings')).toBe(true);
    expect(isFixedValueItem('Normal', 'Rune')).toBe(true);
    expect(isFixedValueItem('Rare', 'Body Armours')).toBe(false);
  });
});

describe('end-to-end parse → match → query', () => {
  it('prices a rare by its matched stats', () => {
    const item = parseItemText(RARE_ITEM);
    const compiled = compileStats(STATS);
    const matched = item.modLines
      .map((line) => matchModLine(compiled, line))
      .filter((match): match is NonNullable<typeof match> => match !== null);
    expect(matched.map((match) => match.statId)).toEqual([
      'explicit.stat_life',
      'explicit.stat_fireres',
      'implicit.stat_rarity',
    ]);
    const built = buildQuery({
      rarity: item.rarity,
      name: item.name,
      baseType: item.baseType,
      itemLevel: item.itemLevel,
      quality: item.quality,
      corrupted: item.corrupted,
      matchedStats: matched,
    });
    expect((built.query as { type: string }).type).toBe('Advanced Dualstring Armour');
  });

  it('recognises the unique path from raw text', () => {
    const item = parseItemText(UNIQUE_ITEM);
    expect(isFixedValueItem(item.rarity, item.itemClass)).toBe(true);
  });
});
