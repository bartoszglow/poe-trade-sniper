import type { DealHitInfo, Listing } from '@poe-sniper/shared';
import type { BuyState, TravelState } from '../hooks/EventStreamProvider';
import { useT } from '../i18n/i18n';
import { composeDealContext } from '../lib/deal-display';
import { DealBadge } from './DealBadge';
import { HitActions, HitBuyStatus } from './HitActions';
import { PriceTag } from './PriceTag';
import { RarityName } from './RarityName';
import { formatRelativeMagnitude } from '../lib/relative-time';

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
  /** Re-resolve a fresh token server-side, then travel (aged/failed hits). */
  onTravelRetry: () => Promise<void>;
  /** Re-resolve a fresh token server-side, then buy on arrival (aged hits). */
  onBuyRetry: () => Promise<void>;
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
  onTravelRetry,
  onBuyRetry,
  onLocateSearch,
}: HitCardProps) {
  const t = useT();

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
        {/* Only securable (instant-buyout) listings carry a token — the sole hits
            that can travel. An aged card keeps its (now-stale) token field, so the
            cluster still shows and re-resolves on click. */}
        {listing.hideoutToken && (
          <HitActions
            travelState={travelState}
            tokenFresh={tokenFresh}
            canBuy={canBuy}
            onTravel={onTravel}
            onBuy={onBuy}
            onTravelRetry={onTravelRetry}
            onBuyRetry={onBuyRetry}
          />
        )}
      </div>
      <HitBuyStatus buyState={buyState} />
    </div>
  );
}
