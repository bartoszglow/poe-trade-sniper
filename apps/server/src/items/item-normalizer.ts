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

/**
 * A mod entry in a trade2 fetch payload is EITHER the display string
 * ("+40 to [Strength|Strength]") OR a structured object that carries the same
 * text under `description` plus roll magnitudes we don't model yet. Both shapes
 * were observed in a single item (implicitMods as strings, explicitMods as
 * objects) — see docs/integration/api-notes.md (2026-06-23).
 */
type RawMod = string | { description?: string };

function modText(mod: RawMod): string | null {
  if (typeof mod === 'string') return mod;
  if (mod && typeof mod === 'object' && typeof mod.description === 'string') {
    return mod.description;
  }
  return null;
}

/** Collapse either mod shape to clean display strings (the domain model). */
function normalizeMods(mods: readonly RawMod[] | undefined): string[] {
  return (mods ?? [])
    .map(modText)
    .filter((text): text is string => text !== null)
    .map(cleanMarkup);
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
    implicitMods?: RawMod[];
    explicitMods?: RawMod[];
    runeMods?: RawMod[];
    craftedMods?: RawMod[];
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
    implicitMods: normalizeMods(record.implicitMods),
    explicitMods: normalizeMods(record.explicitMods),
    runeMods: normalizeMods(record.runeMods),
    craftedMods: normalizeMods(record.craftedMods),
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
