import { useEffect, useState } from 'react';
import type { DealBaselineHistoryEntry, SearchRuntimeInfo } from '@poe-sniper/shared';
import { useT } from '../../i18n/i18n';
import { fetchDealHistory } from '../../lib/deal-watch-api';
import { DealTrendChart } from './DealTrendChart';

/** History page for the trend chart (server caps at 500, default 200). */
const DEAL_HISTORY_LIMIT = 200;

interface DealHistoryCardProps {
  search: SearchRuntimeInfo;
  /** Shared panel tick so relative times age with the rest of the panel. */
  nowMs: number;
  /** Bumped by the deal card after a save / manual refresh — refetch. */
  reloadToken: number;
}

/**
 * The unified panel's market-price-history section (plan 42, D-dw-12).
 * Fetches on panel expand (this card lazy-mounts with the panel), keyed by the
 * swap-stable watchId so a background re-derive never shows another watch's
 * series; without deal mode it explains where history will come from.
 */
export function DealHistoryCard({ search, nowMs, reloadToken }: DealHistoryCardProps) {
  const t = useT();
  const watchId = search.dealWatch?.watchId ?? null;
  const [historyState, setHistoryState] = useState<{
    watchId: string;
    entries: DealBaselineHistoryEntry[] | null;
    failed: boolean;
  } | null>(null);

  useEffect(() => {
    if (watchId === null) return undefined;
    let cancelled = false;
    fetchDealHistory(search.id, DEAL_HISTORY_LIMIT)
      .then((entries) => {
        if (!cancelled) setHistoryState({ watchId, entries, failed: false });
      })
      .catch(() => {
        if (!cancelled) setHistoryState({ watchId, entries: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [watchId, search.id, reloadToken]);

  const current = historyState !== null && historyState.watchId === watchId ? historyState : null;

  return (
    <section className="rounded-md border border-edge bg-surface-2 p-3">
      <h3 className="text-xs font-medium tracking-wide text-ink-muted uppercase">
        {t('searchPanel.history')}
      </h3>
      <div className="mt-2">
        {watchId === null ? (
          <p className="text-xs text-ink-faint">{t('searchPanel.historyDisabled')}</p>
        ) : current?.failed ? (
          <p className="text-xs text-ink-faint">{t('common.requestFailed')}</p>
        ) : current?.entries != null ? (
          <DealTrendChart
            entries={current.entries}
            nowMs={nowMs}
            divinePriceExalted={search.dealWatch?.divinePriceExalted ?? null}
          />
        ) : (
          <p className="text-xs text-ink-faint">{t('searchPanel.historyLoading')}</p>
        )}
      </div>
    </section>
  );
}
