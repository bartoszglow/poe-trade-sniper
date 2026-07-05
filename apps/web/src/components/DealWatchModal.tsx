import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type {
  DealBaselineHistoryEntry,
  DealWatchMode,
  DealWatchUnit,
  SearchRuntimeInfo,
} from '@poe-sniper/shared';
import { useT } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';
import { ApiError } from '../lib/api';
import {
  fetchDealHistory,
  requestDealRefresh,
  type DealRefreshDeclinedCode,
} from '../lib/deal-watch-api';
import {
  DEAL_PATCH_ERROR_KEYS,
  DEAL_STATUS_DISPLAY,
  computeClientCutoffExalted,
  dealDefinitionOf,
  dealQueryPinsItem,
  formatExaltedAmount,
  formatExaltedDetailed,
} from '../lib/deal-watch-display';
import { formatPriceAmount } from '../lib/format-price';
import { formatRelativeMagnitude } from '../lib/relative-time';
import type { UpdateSearchPayload } from '../hooks/useSearches';
import { Badge } from './Badge';
import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import { DealTrendSparkline } from './DealTrendSparkline';
import { Field } from './Field';
import { Modal } from './Modal';
import { Select } from './Select';

/** PriceCheckEditor number-input pattern, sized for the primary threshold field. */
const NUMBER_INPUT_CLASS =
  'w-24 rounded border border-edge bg-surface-2 px-1.5 py-1 text-right font-mono text-sm text-ink focus:border-gold focus:outline-none';

/** History page for the trend sparkline (server caps at 500, default 200). */
const DEAL_HISTORY_LIMIT = 200;

/** Detection-honesty line: a poll-served deal search is blind for sniping. */
type DealDetectionKind = 'ws' | 'poll' | 'none';

const DETECTION_DISPLAY: Record<
  DealDetectionKind,
  { dotClass: string; textClass: string; labelKey: MessageKey }
> = {
  ws: { dotClass: 'bg-ok', textClass: 'text-ink-muted', labelKey: 'dealWatch.detectionWs' },
  poll: { dotClass: 'bg-warn', textClass: 'text-warn', labelKey: 'dealWatch.detectionPoll' },
  none: {
    dotClass: 'bg-surface-3',
    textClass: 'text-ink-faint',
    labelKey: 'dealWatch.detectionOff',
  },
};

const DECLINED_MESSAGE_KEYS: Record<DealRefreshDeclinedCode, MessageKey> = {
  archived: 'dealWatch.refreshDeclined.archived',
  disabled: 'dealWatch.refreshDeclined.disabled',
  paused: 'dealWatch.refreshDeclined.paused',
  'guard-tripped': 'dealWatch.refreshDeclined.guard-tripped',
};

/** Divine-aware amount with the exact exalted value alongside, muted. */
function renderDetailedAmount(amountExalted: number, divinePriceExalted: number | null) {
  const detail = formatExaltedDetailed(amountExalted, divinePriceExalted);
  return (
    <>
      {detail.primary}
      {detail.secondary !== null && (
        <span className="ml-1 font-normal text-ink-faint">({detail.secondary})</span>
      )}
    </>
  );
}

interface DealWatchModalProps {
  open: boolean;
  search: SearchRuntimeInfo;
  /** Global detection pause — a disable then only queues the GGG restore. */
  detectionPaused: boolean;
  onClose: () => void;
  /** The row's PATCH channel; the modal only ever sends `dealWatch`. */
  onUpdate: (payload: UpdateSearchPayload) => Promise<void>;
}

/**
 * Deal-watch configuration modal (plan 41 Phase 2, W1). Enable mode (no
 * dealWatch on the row) shows the config form only; manage mode adds the
 * baseline card, trend sparkline, detection honesty line, manual refresh and
 * the disable flow. Sections stack and the body scrolls, so it degrades to
 * phones without a separate layout.
 */
export function DealWatchModal({
  open,
  search,
  detectionPaused,
  onClose,
  onUpdate,
}: DealWatchModalProps) {
  const t = useT();
  const state = search.dealWatch;
  /** Display-only divine rate, snapshotted server-side at the last refresh. */
  const divineRate = state?.divinePriceExalted ?? null;

  const [draftMode, setDraftMode] = useState<DealWatchMode>('percent');
  const [draftThreshold, setDraftThreshold] = useState('30');
  const [draftUnit, setDraftUnit] = useState<DealWatchUnit>('exalted');
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmingDisable, setConfirmingDisable] = useState(false);

  // History is stored keyed by its watchId and DERIVED against the current
  // watch — so closing the modal or switching watches never needs a clearing
  // setState (a reopen simply derives null until the fresh fetch lands).
  const [historyState, setHistoryState] = useState<{
    watchId: string;
    entries: DealBaselineHistoryEntry[] | null;
    failed: boolean;
  } | null>(null);
  const [historyReloadToken, setHistoryReloadToken] = useState(0);

  const [refreshBusy, setRefreshBusy] = useState(false);
  const [refreshRetryAtMs, setRefreshRetryAtMs] = useState<number | null>(null);
  const [declinedKey, setDeclinedKey] = useState<MessageKey | null>(null);

  // Seed the drafts from the live state each time the modal OPENS — and only
  // then, so an SSE-driven refetch mid-edit never clobbers the operator's
  // typing (adjust-during-render, the SearchesPage layout-sync pattern).
  const [draftsSyncedForOpen, setDraftsSyncedForOpen] = useState(false);
  // One shared ticking clock: the refresh-cooldown countdown and every
  // relative timestamp ("checked 3m ago", trend label) age together.
  const [nowMs, setNowMs] = useState(() => Date.now());
  if (open && !draftsSyncedForOpen) {
    setDraftsSyncedForOpen(true);
    setDraftMode(state?.mode ?? 'percent');
    setDraftThreshold(state !== null ? String(state.thresholdValue) : '30');
    setDraftUnit(state?.unit ?? 'exalted');
    setErrorMessage(null);
    setDeclinedKey(null);
    setRefreshRetryAtMs(null);
  }
  if (!open && draftsSyncedForOpen) setDraftsSyncedForOpen(false);

  useEffect(() => {
    if (!open) return undefined;
    // Immediate async sync so a reopen doesn't show a clock stale since the
    // last close for the first second; then the 1s beat takes over.
    const syncTimer = setTimeout(() => setNowMs(Date.now()), 0);
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => {
      clearTimeout(syncTimer);
      clearInterval(timer);
    };
  }, [open]);

  // Trend history: fetched on open (manage mode only), re-fetched after a save
  // or a successful manual refresh, and when a re-derive swaps the row's id.
  const watchId = state?.watchId ?? null;
  useEffect(() => {
    if (!open || watchId === null) return undefined;
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
  }, [open, watchId, search.id, historyReloadToken]);

  const history =
    historyState !== null && historyState.watchId === watchId ? historyState.entries : null;
  const historyFailed =
    historyState !== null && historyState.watchId === watchId && historyState.failed;

  const parsedThreshold = Number(draftThreshold);
  const thresholdValid =
    draftThreshold.trim() !== '' &&
    Number.isFinite(parsedThreshold) &&
    parsedThreshold > 0 &&
    (draftMode !== 'percent' || parsedThreshold < 100);

  const baselineExalted = state?.baseline?.amountExalted ?? null;
  const cutoffExalted = thresholdValid
    ? computeClientCutoffExalted(
        { mode: draftMode, thresholdValue: parsedThreshold, unit: draftUnit },
        baselineExalted,
      )
    : null;

  const broadQuery = !dealQueryPinsItem(dealDefinitionOf(state, search.filters));
  const statusDisplay = state !== null ? DEAL_STATUS_DISPLAY[state.status] : null;
  const detectionDisplay = DETECTION_DISPLAY[search.engine ?? 'none'];
  const cooldownSecondsLeft =
    refreshRetryAtMs !== null ? Math.max(0, Math.ceil((refreshRetryAtMs - nowMs) / 1_000)) : 0;

  function showError(error: unknown): void {
    // Coded refusals (stackable item, watch cap) map to their catalog message —
    // the operator must never read a generic failure for an intended 409.
    if (error instanceof ApiError && error.code !== null) {
      const mappedKey = DEAL_PATCH_ERROR_KEYS[error.code];
      if (mappedKey !== undefined) {
        setErrorMessage(t(mappedKey));
        return;
      }
    }
    setErrorMessage(
      error instanceof ApiError && error.userFacing ? error.message : t('common.requestFailed'),
    );
  }

  async function save(): Promise<void> {
    if (!thresholdValid) return;
    // Idle Save in manage mode is a no-op close: an unchanged config must not
    // spend GGG budget (editConfig schedules a debounced re-derive regardless).
    const unchanged =
      state !== null &&
      draftMode === state.mode &&
      parsedThreshold === state.thresholdValue &&
      (draftMode !== 'absolute' || draftUnit === state.unit);
    if (unchanged) {
      onClose();
      return;
    }
    setSaving(true);
    setErrorMessage(null);
    try {
      // The unit only means something in absolute mode (D-dw-11); percent
      // omits it so the server keeps its default.
      await onUpdate({
        dealWatch:
          draftMode === 'absolute'
            ? { mode: draftMode, thresholdValue: parsedThreshold, unit: draftUnit }
            : { mode: draftMode, thresholdValue: parsedThreshold },
      });
      setHistoryReloadToken((token) => token + 1);
    } catch (error) {
      showError(error);
    } finally {
      setSaving(false);
    }
  }

  async function runManualRefresh(): Promise<void> {
    setRefreshBusy(true);
    setDeclinedKey(null);
    setErrorMessage(null);
    const outcome = await requestDealRefresh(search.id);
    setRefreshBusy(false);
    if (outcome.kind === 'ok') {
      setHistoryReloadToken((token) => token + 1);
    } else if (outcome.kind === 'cooldown') {
      setRefreshRetryAtMs(Date.now() + outcome.retryInMs);
    } else if (outcome.kind === 'declined') {
      setDeclinedKey(DECLINED_MESSAGE_KEYS[outcome.code]);
    } else {
      setErrorMessage(t('common.requestFailed'));
    }
  }

  async function disableDealWatch(): Promise<void> {
    setErrorMessage(null);
    try {
      await onUpdate({ dealWatch: null });
      onClose();
    } catch (error) {
      showError(error);
    }
  }

  return (
    <Modal open={open} label={t('dealWatch.modalTitle')} onClose={onClose} size="lg">
      <div className="border-b border-edge px-4 py-2.5">
        <h2 className="text-sm font-semibold text-ink">{t('dealWatch.modalTitle')}</h2>
        <p className="truncate text-xs text-ink-faint">{search.label}</p>
      </div>

      <div className="max-h-[65vh] space-y-4 overflow-y-auto p-4">
        {broadQuery && (
          <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
            {t('dealWatch.broadQuery')}
          </p>
        )}

        {/* (a) Threshold configuration */}
        <section className="space-y-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('dealWatch.modeLabel')}>
              <Select
                value={draftMode}
                onChange={(value) => setDraftMode(value === 'absolute' ? 'absolute' : 'percent')}
                options={[
                  { value: 'percent', label: t('dealWatch.mode.percent') },
                  { value: 'absolute', label: t('dealWatch.mode.absolute') },
                ]}
              />
            </Field>
            <Field label={t('dealWatch.thresholdLabel')}>
              <span className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={draftThreshold}
                  onChange={(changeEvent) => setDraftThreshold(changeEvent.target.value)}
                  className={NUMBER_INPUT_CLASS}
                />
                {draftMode === 'percent' && <span className="text-sm text-ink-muted">%</span>}
              </span>
            </Field>
            {draftMode === 'absolute' && (
              <Field label={t('dealWatch.unitLabel')}>
                <Select
                  value={draftUnit}
                  onChange={(value) => setDraftUnit(value === 'divine' ? 'divine' : 'exalted')}
                  options={[
                    { value: 'exalted', label: t('dealWatch.unit.exalted') },
                    { value: 'divine', label: t('dealWatch.unit.divine') },
                  ]}
                />
              </Field>
            )}
          </div>
          {thresholdValid && (
            <p className="text-xs text-ink-muted">
              {cutoffExalted !== null
                ? t('dealWatch.summaryCutoff', {
                    cutoff: formatExaltedAmount(cutoffExalted, divineRate),
                  })
                : draftMode === 'absolute' && draftUnit === 'divine'
                  ? t('dealWatch.summaryDivine', { value: formatPriceAmount(parsedThreshold) })
                  : t('dealWatch.summaryPending')}
            </p>
          )}
        </section>

        {/* (b) Baseline card — manage mode only */}
        {state !== null && statusDisplay !== null && (
          <section className="rounded-md border border-edge p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-medium tracking-wide text-ink-muted uppercase">
                {t('dealWatch.baselineTitle')}
              </h3>
              <Badge tone={statusDisplay.tone}>{t(statusDisplay.labelKey)}</Badge>
            </div>
            {state.baseline !== null ? (
              <>
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
                  <div>
                    <dt className="text-ink-faint">{t('dealWatch.baselineValue')}</dt>
                    <dd className="font-medium text-ink">
                      {renderDetailedAmount(state.baseline.amountExalted, divineRate)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-faint">{t('dealWatch.rawLowest')}</dt>
                    <dd className="text-ink">
                      {renderDetailedAmount(state.baseline.rawLowestExalted, divineRate)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-faint">{t('dealWatch.sampleLabel')}</dt>
                    <dd className="text-ink">
                      {t('dealWatch.sampleOf', {
                        sample: state.baseline.sampleSize,
                        seen: state.baseline.listingsSeen,
                      })}
                    </dd>
                  </div>
                </dl>
                <p className="mt-1.5 text-xs text-ink-faint">
                  {t('dealWatch.checkedAgo', {
                    time: formatRelativeMagnitude(state.baseline.computedAt, nowMs),
                  })}
                </p>
              </>
            ) : (
              <p className="mt-2 text-xs text-ink-faint">{t('dealWatch.baselineMissing')}</p>
            )}
            {state.status === 'baseline-stale' && (
              <p className="mt-1.5 text-xs text-warn">{t('dealWatch.warnStale')}</p>
            )}
            {state.status === 'insufficient-data' && (
              <p className="mt-1.5 text-xs text-warn">{t('dealWatch.warnInsufficient')}</p>
            )}
          </section>
        )}

        {/* (c) Baseline trend — manage mode only */}
        {state !== null && (
          <section>
            <h3 className="text-xs font-medium tracking-wide text-ink-muted uppercase">
              {t('dealWatch.trendTitle')}
            </h3>
            <div className="mt-1.5">
              {historyFailed ? (
                <p className="text-xs text-ink-faint">{t('common.requestFailed')}</p>
              ) : history !== null ? (
                <DealTrendSparkline
                  entries={history}
                  nowMs={nowMs}
                  divinePriceExalted={divineRate}
                />
              ) : null}
            </div>
          </section>
        )}

        {/* (d) Detection honesty — a poll-degraded deal search is not sniping-grade */}
        {state !== null && (
          <section>
            <h3 className="text-xs font-medium tracking-wide text-ink-muted uppercase">
              {t('dealWatch.detectionTitle')}
            </h3>
            <p className={`mt-1.5 flex items-center gap-1.5 text-xs ${detectionDisplay.textClass}`}>
              <span
                aria-hidden
                className={`inline-block h-1.5 w-1.5 rounded-full ${detectionDisplay.dotClass}`}
              />
              {t(detectionDisplay.labelKey)}
            </p>
          </section>
        )}

        {declinedKey !== null && <p className="text-xs text-warn">{t(declinedKey)}</p>}
        {errorMessage !== null && <p className="text-xs text-danger">{errorMessage}</p>}
      </div>

      {/* (e) Actions */}
      <div className="flex flex-wrap items-center gap-2 border-t border-edge px-4 py-2.5">
        {state !== null && (
          <>
            <Button
              variant="ghost"
              disabled={refreshBusy || cooldownSecondsLeft > 0}
              onClick={() => void runManualRefresh()}
            >
              <RefreshCw className="h-4 w-4" />
              {cooldownSecondsLeft > 0
                ? t('dealWatch.refreshCooldown', { seconds: cooldownSecondsLeft })
                : t('dealWatch.refreshCta')}
            </Button>
            <Button variant="danger" onClick={() => setConfirmingDisable(true)}>
              {t('dealWatch.disableCta')}
            </Button>
          </>
        )}
        <div className="flex-1" />
        <Button variant="ghost" onClick={onClose}>
          {t('common.close')}
        </Button>
        <Button variant="primary" disabled={saving || !thresholdValid} onClick={() => void save()}>
          {state !== null ? t('common.save') : t('dealWatch.enableCta')}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmingDisable}
        title={t('dealWatch.disableConfirmTitle')}
        body={
          <>
            <p>{t('dealWatch.disableConfirmBody', { label: search.label })}</p>
            {(detectionPaused ||
              state?.status === 'paused' ||
              state?.status === 'restore-pending') && (
              <p className="mt-1.5 text-xs text-warn">{t('dealWatch.disableConfirmPaused')}</p>
            )}
          </>
        }
        onClose={() => setConfirmingDisable(false)}
        actions={[
          {
            id: 'disable',
            label: t('dealWatch.disableCta'),
            onSelect: () => void disableDealWatch(),
          },
        ]}
      />
    </Modal>
  );
}
