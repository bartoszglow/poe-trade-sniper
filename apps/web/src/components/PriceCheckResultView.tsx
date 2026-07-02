import { useState } from 'react';
import type { PriceCheckResult } from '@poe-sniper/shared';
import { PriceTag } from './PriceTag';
import { useT } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';

const DECLINE_KEY: Record<string, MessageKey> = {
  'budget-low': 'priceCheck.declineBudget',
  'no-session': 'priceCheck.declineNoSession',
  'guard-tripped': 'priceCheck.declineGuard',
  'no-price-data': 'priceCheck.declineNoData',
};

/**
 * The shared rendering of ONE price-check result (#37) — used by the side
 * panel, the Settings test bench and the Price Checks view, so they stay
 * consistent. Shows what was priced (name + base) and how (aggregate estimate,
 * comparable listings, or an honest unavailable note), with the unmatched mod
 * lines collapsible so the operator knows what the estimate ignored.
 */
export function PriceCheckResultView({
  result,
  maxListings = 10,
}: {
  result: PriceCheckResult;
  maxListings?: number;
}) {
  const t = useT();
  const [showUnmatched, setShowUnmatched] = useState(false);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <span className="truncate text-sm font-medium text-ink">
          {result.item.name ?? result.item.baseType ?? t('priceCheck.unknownItem')}
        </span>
        {result.item.baseType && result.item.baseType !== result.item.name && (
          <span className="truncate text-xs text-ink-faint">{result.item.baseType}</span>
        )}
      </div>

      {result.kind === 'aggregate' && result.estimate && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-muted">{t('priceCheck.estimate')}</span>
          <PriceTag price={result.estimate} />
        </div>
      )}

      {result.kind === 'listings' &&
        (result.listings.length === 0 ? (
          <p className="text-xs text-ink-faint">{t('priceCheck.noListings')}</p>
        ) : (
          <div className="flex flex-col gap-1">
            {result.listings.slice(0, maxListings).map((listing, index) => (
              <div
                key={index}
                className="flex items-center gap-2 rounded-md border border-edge bg-surface-2 px-2.5 py-1"
              >
                <PriceTag price={listing.price} />
                {listing.seller && (
                  <span className="truncate text-xs text-ink-faint">{listing.seller}</span>
                )}
              </div>
            ))}
          </div>
        ))}

      {result.kind === 'unavailable' && (
        <p className="text-xs text-warn">
          {t(
            result.declineReason
              ? (DECLINE_KEY[result.declineReason] ?? 'priceCheck.declineEmpty')
              : 'priceCheck.declineEmpty',
          )}
        </p>
      )}

      {result.item.unmatchedLines.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowUnmatched((previous) => !previous)}
            className="text-xs text-ink-faint hover:text-ink"
          >
            {t('priceCheck.unmatched', { count: result.item.unmatchedLines.length })}
          </button>
          {showUnmatched && (
            <ul className="mt-1 space-y-0.5">
              {result.item.unmatchedLines.map((line, index) => (
                <li key={index} className="truncate text-xs text-ink-faint/70">
                  {line}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
