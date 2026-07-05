import { useState } from 'react';
import { RotateCcw, ShoppingCart, Zap } from 'lucide-react';
import type { DealHitInfo, Listing } from '@poe-sniper/shared';
import type { BuyState, TravelState } from '../hooks/EventStreamProvider';
import { useT } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';
import { composeDealContext } from '../lib/deal-display';
import { travelFailureDisplay } from '../lib/travel-failure-display';
import { Button } from './Button';
import { DealBadge } from './DealBadge';
import { PriceTag } from './PriceTag';
import { RarityName } from './RarityName';
import { formatRelativeMagnitude } from '../lib/relative-time';

/** Buy automation phase → compact status line ('unsupported' is hidden). */
const BUY_PHASE_DISPLAY: Partial<Record<BuyState['phase'], { key: MessageKey; tone: string }>> = {
  started: { key: 'hitCard.buying', tone: 'text-gold' },
  'window-found': { key: 'hitCard.buying', tone: 'text-gold' },
  'item-located': { key: 'hitCard.buying', tone: 'text-gold' },
  moved: { key: 'hitCard.buyReady', tone: 'text-ok' },
  aborted: { key: 'hitCard.buyAborted', tone: 'text-ink-faint' },
  failed: { key: 'hitCard.buyFailed', tone: 'text-danger' },
};

interface HitCardProps {
  /** The folded feed entity — deal-mode hits carry their discount context (plan 41). */
  listing: Listing & { deal?: DealHitInfo | null };
  travelState: TravelState | undefined;
  buyState: BuyState | undefined;
  /** Tokens die at ~300 s; the button greys out client-side at 240 s. */
  tokenFresh: boolean;
  /** Older than the freshness window — dimmed so the eye tracks recent hits. */
  stale?: boolean;
  /** Clock snapshot for the live "x ago" — passed in so render stays pure. */
  nowMs: number;
  /** macOS control permission present (desktop + granted) — gates manual Buy. */
  canBuy: boolean;
  /** The source search's label; null when the search is gone (chip hidden). */
  searchLabel: string | null;
  /** Approx market price of the source item (D-dw-14) — non-deal hits show it
   *  as buy context; deal hits use their own flip line instead. */
  marketPriceLabel?: string | null;
  onTravel: () => void;
  onBuy: () => void;
  /** Re-resolve a fresh token server-side, then travel (for aged/failed hits). */
  onRetry: () => Promise<void>;
  /** Spotlight the source search on the Searches view (#34 follow-up). */
  onLocateSearch: () => void;
}

export function HitCard({
  listing,
  travelState,
  buyState,
  tokenFresh,
  stale = false,
  nowMs,
  canBuy,
  searchLabel,
  marketPriceLabel = null,
  onTravel,
  onBuy,
  onRetry,
  onLocateSearch,
}: HitCardProps) {
  const t = useT();
  const phase = travelState?.phase;
  const travelBusy = phase === 'queued' || phase === 'started';
  const buyDisplay = buyState ? BUY_PHASE_DISPLAY[buyState.phase] : undefined;
  const travelFail = travelFailureDisplay(travelState?.reason);
  const [retrying, setRetrying] = useState(false);

  // Re-resolve a fresh token, then travel. Used for the failed-phase Retry and for a stale
  // (token-expired) Travel — both work regardless of the original token's age.
  async function reResolveTravel(): Promise<void> {
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div
      className={`rounded-md border border-edge bg-surface-2 px-3 py-2 transition-opacity ${
        stale ? 'opacity-45' : ''
      }`}
    >
      <div className="flex items-baseline gap-2">
        <span
          className="font-mono text-[0.65rem] text-ink-faint"
          title={new Date(listing.detectedAt).toLocaleString()}
        >
          {t('common.ago', { value: formatRelativeMagnitude(listing.detectedAt, nowMs) })}
        </span>
        <span className="font-mono text-[0.6rem] text-ink-faint/70">
          {new Date(listing.detectedAt).toLocaleTimeString()}
        </span>
        <RarityName name={listing.itemName} rarity={listing.item?.rarity ?? null} />
        {listing.deal && <DealBadge deal={listing.deal} />}
        {searchLabel !== null && (
          <>
            <div className="flex-1" />
            {/* Source-search chip: shows where the hit came from; clicking it
                spotlights that search on the Searches view. Shrinkable with a
                floor so a long label + long item word can't overflow the card
                at the panel's 320px minimum width. */}
            <button
              type="button"
              onClick={onLocateSearch}
              title={searchLabel}
              aria-label={t('hitCard.locateSearch')}
              className="min-w-12 max-w-36 shrink truncate rounded bg-surface-3 px-1.5 py-0.5 text-[0.6rem] text-ink-muted transition-colors hover:text-gold"
            >
              {searchLabel}
            </button>
          </>
        )}
      </div>
      {/* Flip context for deal hits — listed vs expected resale (plan 41).
          Non-deal hits show the item's approximate market price instead, so the
          operator knows what the listed price compares against (D-dw-14). */}
      {listing.deal ? (
        <div className="mt-0.5 text-[0.7rem] text-ink-muted">
          {composeDealContext(listing.price, listing.deal, t)}
        </div>
      ) : (
        marketPriceLabel !== null && (
          <div className="mt-0.5 text-[0.7rem] text-ink-faint">
            {t('hitCard.marketContext', { price: marketPriceLabel })}
          </div>
        )
      )}
      <div className="mt-1 flex items-center gap-2">
        <PriceTag price={listing.price} />
        {listing.seller && (
          <span className="truncate text-xs text-ink-faint">{listing.seller}</span>
        )}
        <div className="flex-1" />
        {listing.hideoutToken && (
          <div className="flex items-center gap-2">
            {phase === 'queued' && <span className="text-xs text-gold">{t('hitCard.queued')}</span>}
            {phase === 'started' && (
              <span className="text-xs text-gold">{t('hitCard.traveling')}</span>
            )}
            {phase === 'success' && (
              <span className="text-xs text-ok">{t('hitCard.traveled')}</span>
            )}
            {phase === 'failed' && (
              <>
                <span className={`text-xs ${travelFail.tone}`}>{t(travelFail.key)}</span>
                <Button
                  variant="ghost"
                  className="!px-2 !py-0.5 text-xs"
                  disabled={retrying}
                  title={t('hitCard.retryTitle')}
                  onClick={() => void reResolveTravel()}
                >
                  <RotateCcw className="h-3 w-3" />
                  {retrying ? t('hitCard.retrying') : t('hitCard.retry')}
                </Button>
              </>
            )}
            {!phase && (
              <Button
                variant="primary"
                className="!px-2 !py-0.5 text-xs"
                disabled={travelBusy || retrying}
                title={tokenFresh ? t('hitCard.travelTitle') : t('hitCard.retryTitle')}
                onClick={() => (tokenFresh ? onTravel() : void reResolveTravel())}
              >
                <Zap className="h-3 w-3" />
                {retrying ? t('hitCard.retrying') : t('hitCard.travel')}
              </Button>
            )}
            {canBuy && !travelBusy && (
              <Button
                variant="ghost"
                className="!px-2 !py-0.5 text-xs"
                disabled={!tokenFresh}
                title={tokenFresh ? t('hitCard.buyTitle') : t('hitCard.tokenExpired')}
                onClick={onBuy}
              >
                <ShoppingCart className="h-3 w-3" />
                {t('hitCard.buy')}
              </Button>
            )}
          </div>
        )}
      </div>
      {buyDisplay && (
        <div className="mt-1 text-xs">
          <span className={buyDisplay.tone}>{t(buyDisplay.key)}</span>
        </div>
      )}
    </div>
  );
}
