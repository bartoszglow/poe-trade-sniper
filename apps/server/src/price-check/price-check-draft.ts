/**
 * Turns a parsed+matched item into an editable `PriceCheckDraft` (#38 A). PURE.
 *
 * The STAT filters come straight from the dictionary matches, so the large and
 * ever-growing GGG stat set appears automatically — no hardcoding. The item-level
 * ATTRIBUTE filters come from a small registry (`ATTRIBUTE_FILTERS`): one entry per
 * attribute, so a new GGG property is an additive entry, not a modified switch
 * (open/closed). Serialization back to a trade2 query lives in query-from-filters.
 */
import type { PriceCheckDraft, PriceCheckFilter } from '@poe-sniper/shared';
import type { ParsedItem } from './item-text-parser.js';
import type { StatMatch } from './stat-matcher.js';
import { isFixedValueItem } from './query-builder.js';

/** Widen a positive roll DOWN by this fraction for the default stat min. */
const ROLL_TOLERANCE = 0.1;

function defaultStatMin(rolls: number[]): number | null {
  if (rolls.length === 0) return null;
  const roll = Math.min(...rolls);
  return roll > 0 ? Math.floor(roll * (1 - ROLL_TOLERANCE)) : roll;
}

/** One item-level attribute the editor can toggle/edit. Registry-driven (D-ed-2). */
interface AttrDescriptor {
  attr: string;
  label: string;
  inputType: 'number-min' | 'bool';
  /** Read the value off the parsed item, or null when the item doesn't carry it. */
  read: (item: ParsedItem) => { value: number | boolean; enabledByDefault: boolean } | null;
}

const ATTRIBUTE_FILTERS: AttrDescriptor[] = [
  {
    attr: 'itemLevel',
    label: 'Item level (min)',
    inputType: 'number-min',
    read: (item) =>
      item.itemLevel !== null ? { value: item.itemLevel, enabledByDefault: false } : null,
  },
  {
    attr: 'quality',
    label: 'Quality (min)',
    inputType: 'number-min',
    read: (item) =>
      item.quality !== null && item.quality > 0
        ? { value: item.quality, enabledByDefault: false }
        : null,
  },
  {
    attr: 'corrupted',
    label: 'Corrupted',
    inputType: 'bool',
    read: (item) => (item.corrupted ? { value: true, enabledByDefault: false } : null),
  },
];

export function buildDraft(options: {
  item: ParsedItem;
  matched: StatMatch[];
  unmatched: string[];
  league: string;
  /** The resolved, dictionary-known base type (from the service), or null. */
  baseType: string | null;
  /** Tier-2 (#38 B): annotate a stat's roll with its tier, when tier data is loaded. */
  tierForRoll?: (
    statId: string,
    roll: number | null,
  ) => { tier: number; min: number; max: number } | null;
}): PriceCheckDraft {
  const { item, matched, unmatched, league, baseType, tierForRoll } = options;

  const statFilters: PriceCheckFilter[] = matched.map((match, index) => {
    const roll = match.values.length > 0 ? Math.min(...match.values) : null;
    return {
      id: `stat:${index}:${match.statId}`,
      kind: 'stat',
      statId: match.statId,
      text: match.text,
      statType: match.type,
      enabled: true,
      rolls: match.values,
      min: defaultStatMin(match.values),
      max: null,
      tier: tierForRoll?.(match.statId, roll) ?? null,
    };
  });

  const attrFilters: PriceCheckFilter[] = [];
  // Base type as a toggleable text attr — default ON when the dictionary knows it.
  if (baseType) {
    attrFilters.push({
      id: 'attr:baseType',
      kind: 'attr',
      attr: 'baseType',
      label: 'Base type',
      enabled: true,
      inputType: 'text',
      value: baseType,
    });
  }
  for (const descriptor of ATTRIBUTE_FILTERS) {
    const read = descriptor.read(item);
    if (!read) continue;
    attrFilters.push({
      id: `attr:${descriptor.attr}`,
      kind: 'attr',
      attr: descriptor.attr,
      label: descriptor.label,
      enabled: read.enabledByDefault,
      inputType: descriptor.inputType,
      value: read.value,
    });
  }

  return {
    item: {
      name: item.name,
      baseType: item.baseType,
      itemClass: item.itemClass,
      rarity: item.rarity,
    },
    league,
    filters: [...attrFilters, ...statFilters],
    unmatched,
    fixedValue: isFixedValueItem(item.rarity, item.itemClass),
  };
}
