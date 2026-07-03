import { describe, expect, it } from 'vitest';
import {
  COMPACT_ROW_MAX_CHARS,
  detailRowLayout,
  isCompactRowGroup,
  type DetailRowData,
} from './detail-layout';

const row = (label: string, value?: string): DetailRowData => ({ label, value });

describe('isCompactRowGroup', () => {
  it('is true for a group of short scalar rows', () => {
    expect(isCompactRowGroup([row('Base', 'Diamond'), row('Item level', '84')])).toBe(true);
    expect(isCompactRowGroup([row('Level', '≤ 62'), row('Dex', '≤ 165')])).toBe(true);
  });

  it('is false when any row is a long affix sentence', () => {
    expect(
      isCompactRowGroup([
        row('+# to maximum Life', '80–'),
        row('Adds # to # Physical Damage to Attacks', '40–'),
      ]),
    ).toBe(false);
  });

  it('counts label + value together, so a short label with a long value is not compact', () => {
    expect(isCompactRowGroup([row('Base', 'Advanced Dualstring Bow')])).toBe(false);
    expect(isCompactRowGroup([row('Base', 'Diamond')])).toBe(true);
  });

  it('counts a label-only row by its label length', () => {
    expect(isCompactRowGroup([row('Instant Buyout')])).toBe(true);
    expect(isCompactRowGroup([row('Only affects Passives in Medium-Large Ring')])).toBe(false);
  });

  it('is exactly inclusive at the threshold', () => {
    const atLimit = 'x'.repeat(COMPACT_ROW_MAX_CHARS);
    const overLimit = 'x'.repeat(COMPACT_ROW_MAX_CHARS + 1);
    expect(isCompactRowGroup([row(atLimit)])).toBe(true);
    expect(isCompactRowGroup([row(overLimit)])).toBe(false);
  });

  it('is false for an empty group', () => {
    expect(isCompactRowGroup([])).toBe(false);
  });
});

describe('detailRowLayout', () => {
  it('maps compact groups to columns and everything else to stack', () => {
    expect(detailRowLayout([row('Rarity', 'Rare'), row('Category', 'Bow')])).toBe('columns');
    expect(detailRowLayout([row('#% increased Physical Damage', '120–')])).toBe('stack');
    expect(detailRowLayout([])).toBe('stack');
  });
});
