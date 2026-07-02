import { Coins, Eraser } from 'lucide-react';
import { PriceCheckResultView } from '../components/PriceCheckResultView';
import { usePriceCheck } from '../hooks/usePriceCheck';
import { useT } from '../i18n/i18n';

/**
 * In-app price-check result (#37): the bottom half of the Live Hits column when
 * the 'panel' sink is enabled. Shows what was priced (name + which stats were
 * used, unmatched greyed) and the comparable listings / aggregate estimate.
 */
export function PriceCheckPanel() {
  const t = useT();
  const { result, checking, clear } = usePriceCheck();

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
          <div className="p-3">
            <PriceCheckResultView result={result} />
          </div>
        )}
      </div>
    </div>
  );
}
