import type { MarketPriceSnapshot, SearchRuntimeInfo } from '@poe-sniper/shared';
import { formatExaltedAmount } from './deal-watch-display';

/**
 * The approximate market price of a search, divine-aware and prefixed with `~`
 * (it is a robust estimate, not an exact quote — D-dw-14). Null when the search
 * has no snapshot yet (thin market, first check pending, or checks disabled).
 */
export function formatApproxMarketPrice(marketPrice: MarketPriceSnapshot | null): string | null {
  if (marketPrice === null) return null;
  return `~${formatExaltedAmount(marketPrice.baseline.amountExalted, marketPrice.divinePriceExalted)}`;
}

/**
 * Resolve a listing's search back to its market snapshot for the per-hit price
 * context — the panel already resolves the searches list for labels, so callers
 * pass that same lookup rather than re-fetching.
 */
export function marketPriceForListing(
  searchId: string,
  searches: readonly SearchRuntimeInfo[],
): MarketPriceSnapshot | null {
  return searches.find((search) => search.id === searchId)?.marketPrice ?? null;
}
