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
