import { useState } from 'react';
import { Coins, Eraser, X } from 'lucide-react';
import type { PriceCheckResult } from '@poe-sniper/shared';
import { PriceTag } from '../components/PriceTag';
import { usePriceCheck } from '../hooks/usePriceCheck';
import { useT } from '../i18n/i18n';

function DeclineNote({ result }: { result: PriceCheckResult }) {
  const t = useT();
  const key =
    result.declineReason === 'budget-low'
      ? 'priceCheck.declineBudget'
      : result.declineReason === 'no-session'
        ? 'priceCheck.declineNoSession'
        : result.declineReason === 'guard-tripped'
          ? 'priceCheck.declineGuard'
          : 'priceCheck.declineEmpty';
  return <p className="px-3 py-2 text-xs text-warn">{t(key)}</p>;
}

function ResultBody({ result }: { result: PriceCheckResult }) {
  const t = useT();
  if (result.kind === 'unavailable') return <DeclineNote result={result} />;
  return (
    <div className="flex flex-col gap-2 p-2">
      {result.kind === 'aggregate' && result.estimate && (
        <div className="flex items-center gap-2 rounded-md border border-edge bg-surface-2 px-3 py-2">
          <Coins className="h-4 w-4 text-gold" />
          <span className="text-sm text-ink">{t('priceCheck.estimate')}</span>
          <div className="flex-1" />
          <PriceTag price={result.estimate} />
        </div>
      )}
      {result.kind === 'listings' &&
        (result.listings.length === 0 ? (
          <p className="px-3 py-2 text-xs text-ink-faint">{t('priceCheck.noListings')}</p>
        ) : (
          result.listings.map((listing, index) => (
            <div
              key={index}
              className="flex items-center gap-2 rounded-md border border-edge bg-surface-2 px-3 py-1.5"
            >
              <PriceTag price={listing.price} />
              {listing.seller && (
                <span className="truncate text-xs text-ink-faint">{listing.seller}</span>
              )}
            </div>
          ))
        ))}
    </div>
  );
}

/**
 * In-app price-check result (#37): the bottom half of the Live Hits column when
 * the 'panel' sink is enabled. Shows what was priced (name + which stats were
 * used, unmatched greyed) and the comparable listings / aggregate estimate.
 */
export function PriceCheckPanel() {
  const t = useT();
  const { result, checking, clear } = usePriceCheck();
  const [showUnmatched, setShowUnmatched] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-edge px-4 py-2.5">
        <Coins className="h-3.5 w-3.5 text-gold" />
        <span className="text-xs font-semibold tracking-widest text-ink-muted uppercase">
          {t('priceCheck.title')}
        </span>
        <div className="flex-1" />
        {checking && <span className="text-xs text-ink-faint">{t('priceCheck.checking')}</span>}
        {result && (
          <button
            type="button"
            onClick={clear}
            title={t('priceCheck.clear')}
            aria-label={t('priceCheck.clear')}
            className="rounded p-1 text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <Eraser className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {!result ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center">
            <p className="text-sm text-ink-faint">{t('priceCheck.empty')}</p>
          </div>
        ) : (
          <>
            <div className="flex items-baseline gap-2 border-b border-edge px-3 py-2">
              <span className="truncate text-sm font-medium text-ink">
                {result.item.name ?? result.item.baseType ?? t('priceCheck.unknownItem')}
              </span>
              {result.item.baseType && result.item.baseType !== result.item.name && (
                <span className="truncate text-xs text-ink-faint">{result.item.baseType}</span>
              )}
            </div>
            <ResultBody result={result} />
            {result.item.unmatchedLines.length > 0 && (
              <div className="px-3 pb-2">
                <button
                  type="button"
                  onClick={() => setShowUnmatched((previous) => !previous)}
                  className="flex items-center gap-1 text-xs text-ink-faint hover:text-ink"
                >
                  <X className="h-3 w-3" />
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
          </>
        )}
      </div>
    </div>
  );
}
