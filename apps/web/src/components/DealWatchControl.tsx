import type { SearchRuntimeInfo } from '@poe-sniper/shared';
import { useT } from '../i18n/i18n';
import {
  DEAL_DOT_CLASSES,
  DEAL_STATUS_DISPLAY,
  formatDealCutoffChip,
  formatDealThresholdChip,
} from '../lib/deal-watch-display';
import { Badge } from './Badge';
import { Tooltip } from './Tooltip';

interface DealWatchControlProps {
  search: SearchRuntimeInfo;
  /** Expands the row's detail panel at the deal card (plan 42 — no popup). */
  onExpandDeal: () => void;
}

/**
 * The SearchRow's DEAL control (plan 41 Phase 2, reshaped by plan 42): a gold
 * threshold chip with a status dot, shown ONLY when the search has a deal
 * watch. It expands the row's unified detail panel at the deal card. A search
 * WITHOUT a deal watch shows nothing here (operator iteration 2026-07-05) —
 * enabling deal mode lives in the panel's Deal watch card.
 */
export function DealWatchControl({ search, onExpandDeal }: DealWatchControlProps) {
  const t = useT();
  const state = search.dealWatch;
  const statusDisplay = state !== null ? DEAL_STATUS_DISPLAY[state.status] : null;

  if (state === null || statusDisplay === null) return null;
  return (
    <Tooltip content={t(statusDisplay.labelKey)} focusable={false}>
      <button
        type="button"
        aria-label={t('dealWatch.manage')}
        onClick={onExpandDeal}
        className="flex items-center gap-1 rounded transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-1 focus-visible:ring-gold"
      >
        <Badge tone="gold">
          <span
            aria-hidden
            className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${DEAL_DOT_CLASSES[statusDisplay.dotState]}`}
          />
          {formatDealThresholdChip(state.mode, state.thresholdValue, state.unit)}
        </Badge>
        {/* The actual buy-below price (D-dw-6 cap) — null before the first
            derive lands, so a fresh percent-mode watch shows only the % chip. */}
        {state.capExalted !== null && (
          <Badge tone="neutral">
            {formatDealCutoffChip(state.capExalted, state.divinePriceExalted)}
          </Badge>
        )}
      </button>
    </Tooltip>
  );
}
