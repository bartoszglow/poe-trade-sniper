import { useState } from 'react';
import { RotateCcw, ShoppingCart, Zap } from 'lucide-react';
import type { Listing, TravelFailureReason } from '@poe-sniper/shared';
import type { BuyState, TravelState } from '../hooks/EventStreamProvider';
import { useT } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';
import { Button } from './Button';
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

/**
 * A failed travel's GGG reason → a friendly label + tone. A sold item ('item_gone') is
 * muted, not alarming — it's expected in a fast market; a rate-limit is gold (actionable).
 * Unmapped reasons ('forbidden' / 'unknown') fall back to the plain red "failed".
 */
const TRAVEL_FAIL_DISPLAY: Partial<Record<TravelFailureReason, { key: MessageKey; tone: string }>> =
  {
    item_gone: { key: 'hitCard.travelGone', tone: 'text-ink-muted' },
    rate_limited: { key: 'hitCard.travelRateLimited', tone: 'text-gold' },
  };

interface HitCardProps {
  listing: Listing;
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
  onTravel: () => void;
  onBuy: () => void;
  /** Re-resolve a fresh token server-side, then travel (for aged/failed hits). */
  onRetry: () => Promise<void>;
}

export function HitCard({
  listing,
  travelState,
  buyState,
  tokenFresh,
  stale = false,
  nowMs,
  canBuy,
  onTravel,
  onBuy,
  onRetry,
}: HitCardProps) {
  const t = useT();
  const phase = travelState?.phase;
  const travelBusy = phase === 'queued' || phase === 'started';
  const buyDisplay = buyState ? BUY_PHASE_DISPLAY[buyState.phase] : undefined;
  const travelFailDisplay = travelState?.reason
    ? TRAVEL_FAIL_DISPLAY[travelState.reason]
    : undefined;
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
      </div>
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
                <span
                  className={`text-xs ${travelFailDisplay?.tone ?? 'text-danger'}`}
                  title={travelState?.detail ?? undefined}
                >
                  {t(travelFailDisplay?.key ?? 'hitCard.failed')}
                </span>
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
          <span className={buyDisplay.tone} title={buyState?.detail ?? undefined}>
            {t(buyDisplay.key)}
          </span>
        </div>
      )}
    </div>
  );
}
