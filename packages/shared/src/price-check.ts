import type { ListingPrice } from './item.js';

/** How a price-check result was priced — drives the UI framing. */
export type PriceCheckKind =
  /** Fixed-value item (currency/rune/unique) via the poe2scout aggregator. */
  | 'aggregate'
  /** Rare/magic/base priced by comparable trade2 listings. */
  | 'listings'
  /** Nothing to price (empty/unparseable) or the budget router declined. */
  | 'unavailable';

/** One comparable listing shown for a rare-item price check. */
export interface PriceCheckListing {
  price: ListingPrice | null;
  seller: string | null;
  /** ISO-8601 indexed/listed time when known. */
  indexedAt: string | null;
  /** GGG's pre-templated "@seller Hi, I'd like to buy…" whisper, when present —
   *  the UI offers a copy-to-clipboard so the operator can contact the seller. */
  whisper: string | null;
}

/** A mod line the parser matched to a trade stat (used in the query). */
export interface MatchedStat {
  statId: string;
  text: string;
  values: number[];
}

/**
 * The parsed item, enough for the UI to explain WHAT was priced and HOW —
 * matched stats went into the query, unmatched lines are shown greyed so the
 * operator knows the estimate ignored them.
 */
export interface PriceCheckItem {
  name: string | null;
  baseType: string | null;
  itemClass: string | null;
  rarity: string | null;
  matchedStats: MatchedStat[];
  unmatchedLines: string[];
}

/** Why a price check produced no priced result (honest UI state). */
export type PriceCheckDeclineReason =
  | 'budget-low'
  | 'no-session'
  | 'guard-tripped'
  /** The item parsed fine but the aggregator had no price for it. */
  | 'no-price-data';

export interface PriceCheckResult {
  kind: PriceCheckKind;
  item: PriceCheckItem;
  /** For 'aggregate': a single estimate. */
  estimate: ListingPrice | null;
  /** For 'listings': comparable listings, cheapest first. */
  listings: PriceCheckListing[];
  /** Set when kind === 'unavailable' and a live query was declined. */
  declineReason: PriceCheckDeclineReason | null;
  /** Live SEARCH-budget headroom 0..1 at query time — surfaced in the UI. */
  searchHeadroom: number;
}

/** One persisted recent price check (#17) — the durable backing of the view's history. */
export interface PriceCheckHistoryEntry {
  id: number;
  /** ISO-8601 time the check ran. */
  at: string;
  result: PriceCheckResult;
}

// --- Interactive editor (#38 A): the editable, selectable price-check spec ---

/** How the editor renders + how the server serializes an attribute filter. */
export type FilterInputType = 'number-min' | 'bool' | 'option' | 'text';

/**
 * A dictionary-matched mod line, editable. `rolls` are the parsed values (shown);
 * `min`/`max` are the trade2 stat-filter range the operator can edit. The set of
 * stat filters is data-driven off the dictionary, so new GGG stats appear here
 * automatically (no hardcoding).
 */
export interface PriceCheckStatFilter {
  id: string;
  kind: 'stat';
  statId: string;
  /** Stat template with `#` placeholders (display). */
  text: string;
  /** explicit / implicit / rune / … */
  statType: string;
  enabled: boolean;
  rolls: number[];
  min: number | null;
  max: number | null;
  /** Tier-2 (#38 B): the roll's tier + range, when tier data is loaded. */
  tier?: { tier: number; min: number; max: number } | null;
}

/** An item-level attribute filter (ilvl/quality/corrupted/base type/…), from a
 *  small stable registry — one entry per attribute, so new ones are additive. */
export interface PriceCheckAttrFilter {
  id: string;
  kind: 'attr';
  /** Registry key: 'itemLevel' | 'quality' | 'corrupted' | 'baseType' | … */
  attr: string;
  label: string;
  enabled: boolean;
  inputType: FilterInputType;
  /** Current value (min for number-min, 'true'/'false' for bool, the base string, …). */
  value: string | number | boolean | null;
  options?: Array<{ value: string; label: string }>;
}

export type PriceCheckFilter = PriceCheckStatFilter | PriceCheckAttrFilter;

/** The editable spec produced from a paste — the operator toggles/edits, then prices. */
export interface PriceCheckDraft {
  item: {
    name: string | null;
    baseType: string | null;
    itemClass: string | null;
    rarity: string | null;
  };
  league: string;
  filters: PriceCheckFilter[];
  /** Mod lines that matched no dictionary stat — shown greyed, not queryable. */
  unmatched: string[];
  /** True for fixed-value items (currency/unique): priced by the aggregator, so the
   *  stat filters don't drive the query — the editor notes this. */
  fixedValue: boolean;
}
