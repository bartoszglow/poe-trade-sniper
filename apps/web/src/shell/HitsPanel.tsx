import { useEffect, useState } from 'react';
import { Zap } from 'lucide-react';
import type { Listing } from '@poe-sniper/shared';
import { Badge } from '../components/Badge';
import { HitCard } from '../components/HitCard';
import { useEventStream } from '../hooks/EventStreamProvider';
import { useSearches } from '../hooks/useSearches';
import { useT } from '../i18n/i18n';
import { apiSend } from '../lib/api';

/** Client-side mirror of the server's stale-token guard (240 s). */
const TOKEN_FRESH_MS = 240_000;
/** Re-render cadence: ages out Travel buttons AND ticks the "x ago" labels. */
const FRESHNESS_TICK_MS = 5_000;

export function HitsPanel() {
  const t = useT();
  const { connected, liveHits, travelStateByListingId } = useEventStream();
  const { searches } = useSearches();
  // Clock snapshot in state: render stays pure, buttons age out on the tick.
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), FRESHNESS_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  function travel(listing: Listing): void {
    const search = searches.find((candidate) => candidate.id === listing.searchId);
    if (!search || !listing.hideoutToken) return;
    void apiSend('POST', '/api/travel', {
      token: listing.hideoutToken,
      realm: search.realm,
      league: search.league,
      searchId: search.id,
      listingId: listing.listingId,
      itemName: listing.itemName,
    }).catch(() => {
      // Failure also arrives as a travel event on the stream; nothing to do here.
    });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-edge px-4 py-2.5">
        <Zap className="h-3.5 w-3.5 text-gold" />
        <span className="text-xs font-semibold tracking-widest text-ink-muted uppercase">
          {t('hitsPanel.title')}
        </span>
        <div className="flex-1" />
        <Badge tone={connected ? 'ok' : 'danger'}>
          {connected ? t('common.live') : t('common.offline')}
        </Badge>
      </div>
      {liveHits.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <p className="text-sm text-ink-faint">{t('hitsPanel.empty')}</p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2">
          {liveHits.map((listing) => (
            <HitCard
              key={listing.listingId}
              listing={listing}
              travelState={travelStateByListingId[listing.listingId]}
              tokenFresh={nowMs - new Date(listing.detectedAt).getTime() < TOKEN_FRESH_MS}
              nowMs={nowMs}
              onTravel={() => travel(listing)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
