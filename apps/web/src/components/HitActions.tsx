import { useState } from 'react';
import { RotateCcw, ShoppingCart, Zap } from 'lucide-react';
import type { BuyState, TravelState } from '../hooks/EventStreamProvider';
import { useT } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';
import { travelFailureDisplay } from '../lib/travel-failure-display';
import { Button } from './Button';

/** Buy automation phase → compact status line ('unsupported' is hidden). */
const BUY_PHASE_DISPLAY: Partial<Record<BuyState['phase'], { key: MessageKey; tone: string }>> = {
  started: { key: 'hitCard.buying', tone: 'text-gold' },
  'window-found': { key: 'hitCard.buying', tone: 'text-gold' },
  'item-located': { key: 'hitCard.buying', tone: 'text-gold' },
  moved: { key: 'hitCard.buyReady', tone: 'text-ok' },
  aborted: { key: 'hitCard.buyAborted', tone: 'text-ink-faint' },
  failed: { key: 'hitCard.buyFailed', tone: 'text-danger' },
};

/** The one-line buy-automation status ('buying…', 'cursor on item', 'buy failed'). */
export function HitBuyStatus({ buyState }: { buyState: BuyState | undefined }) {
  const t = useT();
  const display = buyState ? BUY_PHASE_DISPLAY[buyState.phase] : undefined;
  if (!display) return null;
  return (
    <div className="mt-1 text-xs">
      <span className={display.tone}>{t(display.key)}</span>
    </div>
  );
}

interface HitActionsProps {
  travelState: TravelState | undefined;
  /**
   * True only for a live hit whose own token is still fresh — then Travel/Buy use
   * it directly. Otherwise (an aged live card, or ANY persisted hit — the token is
   * never persisted) the actions re-resolve a fresh token server-side first.
   */
  tokenFresh: boolean;
  /** macOS control permission present (desktop + granted) — gates manual Buy. */
  canBuy: boolean;
  /** Direct actions (fresh token). */
  onTravel: () => void;
  onBuy: () => void;
  /** Re-resolve variants (aged) — the server fetches a fresh token first. */
  onTravelRetry: () => Promise<void>;
  onBuyRetry: () => Promise<void>;
}

/**
 * The Travel / Buy / Retry button cluster + travel-phase status for a hit. Shared
 * by the live Hits panel (HitCard) and the persisted Hits view so the phase
 * rendering (the divergence-prone part) lives in exactly one place. The Buy button
 * re-resolves an aged hit just like Travel does — so a recently-missed hit is
 * actionable well past the ~300 s token TTL, bounded by the caller's age window.
 */
export function HitActions({
  travelState,
  tokenFresh,
  canBuy,
  onTravel,
  onBuy,
  onTravelRetry,
  onBuyRetry,
}: HitActionsProps) {
  const t = useT();
  const phase = travelState?.phase;
  const travelBusy = phase === 'queued' || phase === 'started';
  const travelFail = travelFailureDisplay(travelState?.reason);
  const [travelRetrying, setTravelRetrying] = useState(false);
  const [buyRetrying, setBuyRetrying] = useState(false);

  async function reResolve(
    action: () => Promise<void>,
    setBusy: (busy: boolean) => void,
  ): Promise<void> {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {phase === 'queued' && <span className="text-xs text-gold">{t('hitCard.queued')}</span>}
      {phase === 'started' && <span className="text-xs text-gold">{t('hitCard.traveling')}</span>}
      {phase === 'success' && <span className="text-xs text-ok">{t('hitCard.traveled')}</span>}
      {phase === 'failed' && (
        <>
          <span
            className={`text-xs ${travelFail.tone}`}
            title={travelFail.hintKey ? t(travelFail.hintKey) : undefined}
          >
            {t(travelFail.key)}
          </span>
          <Button
            variant="ghost"
            className="!px-2 !py-0.5 text-xs"
            disabled={travelRetrying}
            title={t('hitCard.retryTitle')}
            onClick={() => void reResolve(onTravelRetry, setTravelRetrying)}
          >
            <RotateCcw aria-hidden className="h-3 w-3" />
            {travelRetrying ? t('hitCard.retrying') : t('hitCard.retry')}
          </Button>
        </>
      )}
      {!phase && (
        <Button
          variant="primary"
          className="!px-2 !py-0.5 text-xs"
          disabled={travelBusy || travelRetrying}
          title={tokenFresh ? t('hitCard.travelTitle') : t('hitCard.retryTitle')}
          onClick={() =>
            tokenFresh ? onTravel() : void reResolve(onTravelRetry, setTravelRetrying)
          }
        >
          <Zap aria-hidden className="h-3 w-3" />
          {travelRetrying ? t('hitCard.retrying') : t('hitCard.travel')}
        </Button>
      )}
      {canBuy && !travelBusy && (
        <Button
          variant="ghost"
          className="!px-2 !py-0.5 text-xs"
          disabled={buyRetrying}
          title={tokenFresh ? t('hitCard.buyTitle') : t('hitCard.buyRetryTitle')}
          onClick={() => (tokenFresh ? onBuy() : void reResolve(onBuyRetry, setBuyRetrying))}
        >
          <ShoppingCart aria-hidden className="h-3 w-3" />
          {buyRetrying ? t('hitCard.retrying') : t('hitCard.buy')}
        </Button>
      )}
    </div>
  );
}
