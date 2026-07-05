import { BadgePercent } from 'lucide-react';
import type { SearchRuntimeInfo } from '@poe-sniper/shared';
import { useT } from '../i18n/i18n';
import {
  DEAL_DOT_CLASSES,
  DEAL_STATUS_DISPLAY,
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
 * The SearchRow's DEAL control (plan 41 Phase 2, reshaped by plan 42): a
 * labelled ghost button when the search has no deal watch, or a gold threshold
 * chip with a status dot when it does. Either expands the row's unified detail
 * panel at the deal card — every deal interaction lives there now.
 */
export function DealWatchControl({ search, onExpandDeal }: DealWatchControlProps) {
  const t = useT();
  const state = search.dealWatch;
  const statusDisplay = state !== null ? DEAL_STATUS_DISPLAY[state.status] : null;

  if (state === null || statusDisplay === null) {
    // Labelled like the ACTIVE/TRAVEL/BUY controls — an icon-only ghost
    // button proved undiscoverable for a flagship feature (operator
    // feedback, 2026-07-05).
    return (
      <button
        type="button"
        aria-label={t('dealWatch.configure')}
        title={t('dealWatch.configure')}
        onClick={onExpandDeal}
        className="flex items-center gap-1.5 rounded px-1 py-0.5 text-xs text-ink-muted transition-colors hover:text-gold focus:outline-none focus-visible:ring-1 focus-visible:ring-gold"
      >
        <BadgePercent className="h-4 w-4" />
        {t('dealWatch.rowToggle')}
      </button>
    );
  }
  return (
    <Tooltip content={t(statusDisplay.labelKey)} focusable={false}>
      <button
        type="button"
        aria-label={t('dealWatch.manage')}
        onClick={onExpandDeal}
        className="rounded transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-1 focus-visible:ring-gold"
      >
        <Badge tone="gold">
          <span
            aria-hidden
            className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${DEAL_DOT_CLASSES[statusDisplay.dotState]}`}
          />
          {formatDealThresholdChip(state.mode, state.thresholdValue, state.unit)}
        </Badge>
      </button>
    </Tooltip>
  );
}
