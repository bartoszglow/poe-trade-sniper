import type { ItemDetail, ItemProperty, Listing } from '@poe-sniper/shared';

/**
 * Trade payloads wrap stat names in `[tag|display]` or `[tag]` markup —
 * "[Resistances|Lightning Resistance]" → "Lightning Resistance",
 * "[Bleeding]" → "Bleeding".
 */
export function cleanMarkup(text: string): string {
  return text.replace(
    /\[([^\]|]+)(?:\|([^\]]+))?\]/g,
    (_match, tag: string, display?: string) => display ?? tag,
  );
}

interface RawProperty {
  name?: string;
  values?: Array<[string, number]>;
}

function normalizeProperty(raw: RawProperty): ItemProperty {
  const value = (raw.values ?? []).map((entry) => entry[0]).join(', ') || null;
  return { label: cleanMarkup(raw.name ?? ''), value: value ? cleanMarkup(value) : null };
}

/** Trade payloads sometimes carry only the numeric frameType. */
const RARITY_BY_FRAME: Record<number, string> = {
  0: 'Normal',
  1: 'Magic',
  2: 'Rare',
  3: 'Unique',
};

export function normalizeItemDetail(item: unknown): ItemDetail | null {
  if (!item || typeof item !== 'object') return null;
  const record = item as {
    baseType?: string;
    rarity?: string;
    frameType?: number;
    ilvl?: number;
    corrupted?: boolean;
    properties?: RawProperty[];
    requirements?: RawProperty[];
    implicitMods?: string[];
    explicitMods?: string[];
    runeMods?: string[];
    craftedMods?: string[];
  };
  return {
    rarity:
      record.rarity ??
      (record.frameType != null ? (RARITY_BY_FRAME[record.frameType] ?? null) : null),
    baseType: record.baseType ?? null,
    itemLevel: record.ilvl ?? null,
    corrupted: record.corrupted ?? false,
    properties: (record.properties ?? []).map(normalizeProperty),
    requirements: (record.requirements ?? []).map(normalizeProperty),
    implicitMods: (record.implicitMods ?? []).map(cleanMarkup),
    explicitMods: (record.explicitMods ?? []).map(cleanMarkup),
    runeMods: (record.runeMods ?? []).map(cleanMarkup),
    craftedMods: (record.craftedMods ?? []).map(cleanMarkup),
  };
}

/** One entry of the /api/trade2/fetch result array → domain Listing. */
export function normalizeListing(entry: unknown, searchId: string, detectedAt: string): Listing {
  const record = entry as {
    id?: string;
    item?: { name?: string; typeLine?: string };
    listing?: {
      price?: { amount?: number; currency?: string };
      account?: { name?: string };
      hideout_token?: string;
    };
  };
  return {
    listingId: record?.id ?? '(unknown)',
    searchId,
    itemName:
      [record?.item?.name, record?.item?.typeLine].filter(Boolean).join(' ') || '(unnamed item)',
    price:
      record?.listing?.price?.amount != null
        ? {
            amount: record.listing.price.amount,
            currency: record.listing.price.currency ?? '?',
          }
        : null,
    seller: record?.listing?.account?.name ?? null,
    hideoutToken: record?.listing?.hideout_token ?? null,
    item: normalizeItemDetail(record?.item),
    detectedAt,
  };
}
