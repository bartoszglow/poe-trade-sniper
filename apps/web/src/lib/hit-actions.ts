import { offerKey, type Listing } from '@poe-sniper/shared';

/**
 * The body both re-resolve endpoints (`/api/travel/retry`, `/api/buy/retry`)
 * expect — the stable identity a server re-resolve keys on. Extracted so the
 * client↔server contract lives in one tested place (a key rename can't drift
 * silently past the server's schema).
 */
export function retryPayload(listing: Listing): {
  searchId: string;
  listingId: string;
  offerKey: string;
} {
  return {
    searchId: listing.searchId,
    listingId: listing.listingId,
    offerKey: offerKey(listing),
  };
}

/**
 * A persisted hit stays actionable (Travel/Buy) for this long after detection.
 * Past it, the listing is almost certainly gone and a re-resolve would only waste
 * budget, so the Hits view hides the buttons. Centralized so the window is one
 * tunable, not a magic number inline.
 */
export const HIT_ACTION_MAX_AGE_MS = 60 * 60_000;

/**
 * Whether a hit detected at `detectedAtIso` is still within the action window at
 * `nowMs`. Future timestamps (clock skew) read as actionable — never negative-age
 * hides a just-arrived hit.
 */
export function isHitActionable(detectedAtIso: string, nowMs: number): boolean {
  return nowMs - new Date(detectedAtIso).getTime() <= HIT_ACTION_MAX_AGE_MS;
}
