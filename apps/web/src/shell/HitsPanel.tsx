import { useEffect, useState } from 'react';
import { Eraser, PanelRightClose, Zap } from 'lucide-react';
import { Badge } from '../components/Badge';
import { HitCard } from '../components/HitCard';
import { useEventStream } from '../hooks/EventStreamProvider';
import { useHitActions } from '../hooks/useHitActions';
import { resolveByListingId } from '../lib/live-hits';
import { useSearches } from '../hooks/useSearches';
import { useServerStatus } from '../hooks/useServerStatus';
import { useT } from '../i18n/i18n';
import { formatApproxMarketPrice, marketPriceForListing } from '../lib/market-price';

/** Client-side mirror of the server's stale-token guard (240 s). */
const TOKEN_FRESH_MS = 240_000;
/** Re-render cadence: ages out Travel buttons AND ticks the "x ago" labels. */
const FRESHNESS_TICK_MS = 5_000;
/** Hits older than this are greyed out in the live feed (visual only). */
const STALE_HIT_MS = 300_000;

export function HitsPanel({ onHide }: { onHide: () => void }) {
  const t = useT();
  const { connected, liveHits, travelStateByListingId, buyStateByListingId, clearLiveHits } =
    useEventStream();
  const { searches } = useSearches();
  const { travel, buy, travelRetry, buyRetry, locateSearch } = useHitActions();
  // Manual Buy = travel + grab; only offered when the macOS control permission
  // is present (desktop + granted). On web this is false, so Buy never renders.
  const { status } = useServerStatus();
  const canBuy = status?.capabilities.canControl ?? false;
  // Clock snapshot in state: render stays pure, buttons age out on the tick.
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), FRESHNESS_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // Clearing swaps the card list for the empty state; bump a tick used as a React
  // `key` so that swap remounts fresh and repaints over any leftover card pixels —
  // an intermittent Electron compositing ghost otherwise lingered after clearing.
  const [clearTick, setClearTick] = useState(0);
  function handleClear(): void {
    clearLiveHits();
    setClearTick((tick) => tick + 1);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-edge px-4 py-2.5">
        <Zap className="h-3.5 w-3.5 text-gold" />
        <span className="text-xs font-semibold tracking-widest text-ink-muted uppercase">
          {t('hitsPanel.title')}
        </span>
        <div className="flex-1" />
        {liveHits.length > 0 && (
          <button
            type="button"
            onClick={handleClear}
            title={t('hitsPanel.clear')}
            aria-label={t('hitsPanel.clear')}
            className="rounded p-1 text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <Eraser className="h-3.5 w-3.5" />
          </button>
        )}
        <Badge tone={connected ? 'ok' : 'danger'}>
          {connected ? t('common.live') : t('common.offline')}
        </Badge>
        <button
          type="button"
          onClick={onHide}
          title={t('hitsPanel.hide')}
          aria-label={t('hitsPanel.hide')}
          className="rounded p-1 text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <PanelRightClose className="h-3.5 w-3.5" />
        </button>
      </div>
      {/* Stable scroll container — never unmounted on clear (swapping the whole
          overflow container out was what left the ghost). Only the inner content swaps. */}
      <div
        className="flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable]"
        aria-live="polite"
        aria-atomic="false"
      >
        {liveHits.length === 0 ? (
          <div
            key={`empty-${clearTick}`}
            className="flex flex-1 items-center justify-center px-6 text-center"
          >
            <p className="text-sm text-ink-faint">{t('hitsPanel.empty')}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 p-2">
            {liveHits.map((listing) => (
              <HitCard
                key={listing.listingId}
                listing={listing}
                travelState={resolveByListingId(travelStateByListingId, listing.listingIds)}
                buyState={resolveByListingId(buyStateByListingId, listing.listingIds)}
                tokenFresh={nowMs - new Date(listing.detectedAt).getTime() < TOKEN_FRESH_MS}
                stale={nowMs - new Date(listing.detectedAt).getTime() > STALE_HIT_MS}
                nowMs={nowMs}
                canBuy={canBuy}
                searchLabel={
                  searches.find((search) => search.id === listing.searchId)?.label ?? null
                }
                marketPriceLabel={formatApproxMarketPrice(
                  marketPriceForListing(listing.searchId, searches),
                )}
                onTravel={() => travel(listing)}
                onBuy={() => buy(listing)}
                onTravelRetry={() => travelRetry(listing)}
                onBuyRetry={() => buyRetry(listing)}
                onLocateSearch={() => locateSearch(listing)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
