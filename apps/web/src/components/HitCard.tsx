import { Zap } from 'lucide-react';
import type { Listing } from '@poe-sniper/shared';
import type { TravelState } from '../hooks/EventStreamProvider';
import { useT } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';
import { Button } from './Button';
import { PriceTag } from './PriceTag';
import { RarityName } from './RarityName';

interface HitCardProps {
  listing: Listing;
  travelState: TravelState | undefined;
  /** Tokens die at ~300 s; the button greys out client-side at 240 s. */
  tokenFresh: boolean;
  onTravel: () => void;
}

const TRAVEL_LABEL_KEYS: Record<string, MessageKey> = {
  queued: 'hitCard.queued',
  started: 'hitCard.traveling',
  success: 'hitCard.traveled',
  failed: 'hitCard.failed',
};

export function HitCard({ listing, travelState, tokenFresh, onTravel }: HitCardProps) {
  const t = useT();
  const travelLabelKey = travelState ? TRAVEL_LABEL_KEYS[travelState.phase] : null;
  const travelBusy = travelState?.phase === 'queued' || travelState?.phase === 'started';

  return (
    <div className="rounded-md border border-edge bg-surface-2 px-3 py-2">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[0.65rem] text-ink-faint">
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
        {listing.hideoutToken &&
          (travelLabelKey && travelState ? (
            <span
              className={`text-xs ${
                travelState.phase === 'failed'
                  ? 'text-danger'
                  : travelState.phase === 'success'
                    ? 'text-ok'
                    : 'text-gold'
              }`}
              title={travelState.detail ?? undefined}
            >
              {t(travelLabelKey)}
            </span>
          ) : (
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
          ))}
      </div>
    </div>
  );
}
