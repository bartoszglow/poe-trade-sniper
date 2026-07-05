import { useState } from 'react';
import { BadgePercent } from 'lucide-react';
import type { SearchRuntimeInfo } from '@poe-sniper/shared';
import { useT } from '../i18n/i18n';
import {
  DEAL_DOT_CLASSES,
  DEAL_STATUS_DISPLAY,
  formatDealThresholdChip,
} from '../lib/deal-watch-display';
import type { UpdateSearchPayload } from '../hooks/useSearches';
import { Badge } from './Badge';
import { DealWatchModal } from './DealWatchModal';
import { Tooltip } from './Tooltip';

interface DealWatchControlProps {
  search: SearchRuntimeInfo;
  detectionPaused: boolean;
  onUpdate: (payload: UpdateSearchPayload) => Promise<void>;
}

/**
 * The SearchRow's DEAL control (plan 41 Phase 2, W1): a ghost BadgePercent
 * button when the search has no deal watch, or a gold threshold chip with a
 * status dot when it does. Either opens the DealWatchModal; the modal owns
 * every deal interaction, so the row stays surgical.
 */
export function DealWatchControl({ search, detectionPaused, onUpdate }: DealWatchControlProps) {
  const t = useT();
  const [modalOpen, setModalOpen] = useState(false);
  const state = search.dealWatch;
  const statusDisplay = state !== null ? DEAL_STATUS_DISPLAY[state.status] : null;

  return (
    <>
      {state === null || statusDisplay === null ? (
        // Labelled like the ACTIVE/TRAVEL/BUY controls — an icon-only ghost
        // button proved undiscoverable for a flagship feature (operator
        // feedback, 2026-07-05).
        <button
          type="button"
          aria-label={t('dealWatch.configure')}
          title={t('dealWatch.configure')}
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1.5 rounded px-1 py-0.5 text-xs text-ink-muted transition-colors hover:text-gold focus:outline-none focus-visible:ring-1 focus-visible:ring-gold"
        >
          <BadgePercent className="h-4 w-4" />
          {t('dealWatch.rowToggle')}
        </button>
      ) : (
        <Tooltip content={t(statusDisplay.labelKey)} focusable={false}>
          <button
            type="button"
            aria-label={t('dealWatch.manage')}
            onClick={() => setModalOpen(true)}
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
      )}
      {/* Lazy mount (review P2-8): a closed modal must cost nothing — every
          SSE-driven row re-render would otherwise re-run its query parse. */}
      {modalOpen && (
        <DealWatchModal
          open={modalOpen}
          search={search}
          detectionPaused={detectionPaused}
          onClose={() => setModalOpen(false)}
          onUpdate={onUpdate}
        />
      )}
    </>
  );
}
