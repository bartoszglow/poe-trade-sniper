import { offerKey, type DealHitInfo, type Listing } from '@poe-sniper/shared';

// The offer-identity key is the single source of truth in @poe-sniper/shared — the
// server's LiveOfferRegistry groups by the SAME key, so feed + server never diverge.
export { offerKey };

/**
 * A collapsed live-hit ENTITY: the newest listing for an offer, plus every `listingId`
 * GGG has served for that same offer (newest first). GGG re-serves the same physical
 * offer under fresh result-hash ids — especially after a travel re-query — so a plain
 * listingId key shows the same item twice. We collapse by the visible OFFER identity and:
 *   - use the newest id (`listingId`) for travel/buy communication, and
 *   - keep the older ids so the card can still resolve travel/buy state that was recorded
 *     under an earlier id.
 */
export interface LiveHit extends Listing {
  /** All ids served for this offer, newest first; `listingId` === `listingIds[0]`. */
  listingIds: string[];
  /** Discount context for deal-mode hits; null/absent = an ordinary hit (plan 41). */
  deal?: DealHitInfo | null;
}

/**
 * Fold a freshly detected listing into the newest-first feed: it REPLACES any existing
 * entity for the same offer (merging the differing ids, newest first) and moves to the
 * top, instead of stacking a duplicate card. Bounded to `cap`. Deal context MERGES:
 * a later plain re-serve without `deal` keeps the entity's existing deal fields
 * (plan 41 Web UI — a deal card must not lose its discount on a fold).
 */
export function collapseHit(
  feed: LiveHit[],
  listing: Listing,
  cap: number,
  deal?: DealHitInfo | null,
): LiveHit[] {
  const key = offerKey(listing);
  const existing = feed.find((hit) => offerKey(hit) === key);
  const listingIds = [
    listing.listingId,
    ...(existing?.listingIds ?? []).filter((id) => id !== listing.listingId),
  ];
  const entity: LiveHit = { ...listing, listingIds, deal: deal ?? existing?.deal ?? null };
  return [entity, ...feed.filter((hit) => offerKey(hit) !== key)].slice(0, cap);
}

/** Resolve a per-listingId state map across all of an entity's ids (newest first). */
export function resolveByListingId<StateType>(
  map: Record<string, StateType>,
  listingIds: string[] | undefined,
): StateType | undefined {
  for (const id of listingIds ?? []) {
    const value = map[id];
    if (value !== undefined) return value;
  }
  return undefined;
}
