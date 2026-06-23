import { RotateCcw, Zap } from 'lucide-react';
import type { Listing } from '@poe-sniper/shared';
import type { TravelState } from '../hooks/EventStreamProvider';
import { useT } from '../i18n/i18n';
import { Button } from './Button';
import { PriceTag } from './PriceTag';
import { RarityName } from './RarityName';
import { formatRelativeMagnitude } from '../lib/relative-time';

interface HitCardProps {
  listing: Listing;
  travelState: TravelState | undefined;
  /** Tokens die at ~300 s; the button greys out client-side at 240 s. */
  tokenFresh: boolean;
  /** Older than the freshness window — dimmed so the eye tracks recent hits. */
  stale?: boolean;
  /** Clock snapshot for the live "x ago" — passed in so render stays pure. */
  nowMs: number;
  onTravel: () => void;
}

export function HitCard({
  listing,
  travelState,
  tokenFresh,
  stale = false,
  nowMs,
  onTravel,
}: HitCardProps) {
  const t = useT();
  const phase = travelState?.phase;
  const travelBusy = phase === 'queued' || phase === 'started';

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
                <span className="text-xs text-danger" title={travelState?.detail ?? undefined}>
                  {t('hitCard.failed')}
                </span>
                <Button
                  variant="ghost"
                  className="!px-2 !py-0.5 text-xs"
                  disabled={!tokenFresh}
                  title={tokenFresh ? t('hitCard.travelTitle') : t('hitCard.tokenExpired')}
                  onClick={onTravel}
                >
                  <RotateCcw className="h-3 w-3" />
                  {tokenFresh ? t('hitCard.retry') : t('hitCard.expired')}
                </Button>
              </>
            )}
            {!phase && (
              <Button
                variant="primary"
                className="!px-2 !py-0.5 text-xs"
                disabled={!tokenFresh || travelBusy}
                title={tokenFresh ? t('hitCard.travelTitle') : t('hitCard.tokenExpired')}
                onClick={onTravel}
              >
                <Zap className="h-3 w-3" />
                {tokenFresh ? t('hitCard.travel') : t('hitCard.expired')}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
