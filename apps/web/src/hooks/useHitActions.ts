import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Listing } from '@poe-sniper/shared';
import { useSearches } from './useSearches';
import { apiSend } from '../lib/api';
import { retryPayload } from '../lib/hit-actions';
import { spotlightSearch } from '../lib/search-spotlight';

/**
 * Most action failures (gone / no-budget / travel error) come back as travel/buy
 * events on the SSE stream, which the cards render. The exceptions — a 403 (the
 * control gate revoked between render and click) or a network/400 — carry no
 * event, so log them rather than dropping to a silent no-op (review FEEDBACK).
 */
function warnActionFailed(action: string, error: unknown): void {
  console.warn(`hit action "${action}" failed`, error);
}

/**
 * The one source of truth for hit actions — travel / buy (fresh token), their
 * re-resolve variants for an aged hit, and "spotlight the source search". Shared
 * by the live Hits panel and the persisted Hits view so the two never diverge.
 *
 * Travel/buy failures surface as travel/buy events on the SSE stream (the cards
 * read them by listingId), so these calls swallow their own rejection — there is
 * nothing to do at the call site.
 */
export function useHitActions() {
  const { searches } = useSearches();
  const navigate = useNavigate();
  const location = useLocation();

  // Direct travel — a live hit's own (fresh) token. realm/league locate the Referer.
  const travel = useCallback(
    (listing: Listing): void => {
      const search = searches.find((candidate) => candidate.id === listing.searchId);
      if (!search || !listing.hideoutToken) return;
      void apiSend('POST', '/api/travel', {
        token: listing.hideoutToken,
        realm: search.realm,
        league: search.league,
        searchId: search.id,
        listingId: listing.listingId,
        itemName: listing.itemName,
      }).catch((error) => warnActionFailed('travel', error));
    },
    [searches],
  );

  // Direct buy = travel + grab (fresh token). The server re-checks the control gate.
  const buy = useCallback(
    (listing: Listing): void => {
      const search = searches.find((candidate) => candidate.id === listing.searchId);
      if (!search || !listing.hideoutToken) return;
      void apiSend('POST', '/api/buy', {
        token: listing.hideoutToken,
        realm: search.realm,
        league: search.league,
        searchId: search.id,
        listingId: listing.listingId,
        itemName: listing.itemName,
      }).catch((error) => warnActionFailed('buy', error));
    },
    [searches],
  );

  // Aged travel: the stored token is expired (or never persisted), so the server
  // re-resolves a FRESH token (re-fetch by id, else re-search + match by identity).
  const travelRetry = useCallback(async (listing: Listing): Promise<void> => {
    await apiSend<{ found: boolean }>('POST', '/api/travel/retry', retryPayload(listing)).catch(
      (error) => warnActionFailed('travel-retry', error),
    );
  }, []);

  // Aged buy: re-resolve a fresh token, then buy on arrival (mirrors travelRetry).
  const buyRetry = useCallback(async (listing: Listing): Promise<void> => {
    await apiSend<{ found: boolean }>('POST', '/api/buy/retry', retryPayload(listing)).catch(
      (error) => warnActionFailed('buy-retry', error),
    );
  }, []);

  // Spotlight the hit's source search on the Searches view (#34): navigate there
  // and hand the highlight to the one-slot spotlight store.
  const locateSearch = useCallback(
    (listing: Listing): void => {
      spotlightSearch(listing.searchId);
      if (location.pathname !== '/') void navigate('/');
    },
    [location.pathname, navigate],
  );

  return { travel, buy, travelRetry, buyRetry, locateSearch };
}
