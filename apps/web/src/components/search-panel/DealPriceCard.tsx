import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { DealWatchMode, DealWatchUnit, SearchRuntimeInfo } from '@poe-sniper/shared';
import { useT } from '../../i18n/i18n';
import type { MessageKey } from '../../i18n/messages';
import { ApiError } from '../../lib/api';
import { requestDealRefresh, type DealRefreshDeclinedCode } from '../../lib/deal-watch-api';
import {
  DEAL_PATCH_ERROR_KEYS,
  DEAL_STATUS_DISPLAY,
  computeClientCutoffExalted,
  dealDefinitionOf,
  dealQueryPinsItem,
  formatExaltedAmount,
  formatExaltedDetailed,
} from '../../lib/deal-watch-display';
import { formatPriceAmount } from '../../lib/format-price';
import { formatRelativeMagnitude } from '../../lib/relative-time';
import type { UpdateSearchPayload } from '../../hooks/useSearches';
import { Badge } from '../Badge';
import { Button } from '../Button';
import { ConfirmDialog } from '../ConfirmDialog';
import { Field } from '../Field';
import { Select } from '../Select';

/** PriceCheckEditor number-input pattern, sized for the primary threshold field. */
const NUMBER_INPUT_CLASS =
  'w-24 rounded border border-edge bg-surface-2 px-1.5 py-1 text-right font-mono text-sm text-ink focus:border-gold focus:outline-none';

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

interface DealPriceCardProps {
  search: SearchRuntimeInfo;
  /** Global detection pause — a disable then only queues the GGG restore. */
  detectionPaused: boolean;
  /** Shared panel tick — cooldown countdown + relative times age together. */
  nowMs: number;
  /** The row's PATCH channel; this card only ever sends `dealWatch`. */
  onUpdate: (payload: UpdateSearchPayload) => Promise<void>;
  /** A save / successful manual refresh makes the history card stale. */
  onHistoryStale: () => void;
}

/**
 * The unified panel's deal-price section (plan 42) — the former deal-watch modal
 * body, card-shaped: threshold config with live cutoff, baseline stat block,
 * detection honesty, manual refresh with cooldown, and the disable flow
 * (ConfirmDialog stays — destructive). Enable mode (no dealWatch on the row)
 * renders the intro + config + the Enable action only. Drafts seed on MOUNT:
 * the panel lazy-mounts this card, and while it stays open an SSE refetch must
 * never clobber mid-edit typing.
 */
export function DealPriceCard({
  search,
  detectionPaused,
  nowMs,
  onUpdate,
  onHistoryStale,
}: DealPriceCardProps) {
  const t = useT();
  const state = search.dealWatch;
  /** Display-only divine rate, snapshotted server-side at the last refresh. */
  const divineRate = state?.divinePriceExalted ?? null;

  const [draftMode, setDraftMode] = useState<DealWatchMode>(state?.mode ?? 'percent');
  const [draftThreshold, setDraftThreshold] = useState(
    state !== null ? String(state.thresholdValue) : '30',
  );
  const [draftUnit, setDraftUnit] = useState<DealWatchUnit>(state?.unit ?? 'exalted');
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmingDisable, setConfirmingDisable] = useState(false);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [refreshRetryAtMs, setRefreshRetryAtMs] = useState<number | null>(null);
  const [declinedKey, setDeclinedKey] = useState<MessageKey | null>(null);

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
    // Idle Save is a no-op: an unchanged config must not spend GGG budget
    // (editConfig schedules a debounced re-derive regardless).
    const unchanged =
      state !== null &&
      draftMode === state.mode &&
      parsedThreshold === state.thresholdValue &&
      (draftMode !== 'absolute' || draftUnit === state.unit);
    if (unchanged) return;
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
      onHistoryStale();
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
      onHistoryStale();
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
    } catch (error) {
      showError(error);
    }
  }

  return (
    <section className="rounded-md border border-edge bg-surface-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-medium tracking-wide text-ink-muted uppercase">
          {t('searchPanel.deal')}
        </h3>
        {statusDisplay !== null && (
          <Badge tone={statusDisplay.tone}>{t(statusDisplay.labelKey)}</Badge>
        )}
      </div>

      <div className="mt-2 space-y-3">
        {state === null && <p className="text-xs text-ink-muted">{t('dealWatch.enableIntro')}</p>}
        {broadQuery && (
          <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
            {t('dealWatch.broadQuery')}
          </p>
        )}

        {/* Threshold configuration */}
        <div className="grid gap-3 sm:grid-cols-3">
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

        {/* Baseline block — manage mode only */}
        {state !== null && (
          <div className="rounded-md border border-edge bg-surface-1 p-3">
            {state.baseline !== null ? (
              <>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
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
              <p className="text-xs text-ink-faint">{t('dealWatch.baselineMissing')}</p>
            )}
            {state.status === 'baseline-stale' && (
              <p className="mt-1.5 text-xs text-warn">{t('dealWatch.warnStale')}</p>
            )}
            {state.status === 'insufficient-data' && (
              <p className="mt-1.5 text-xs text-warn">{t('dealWatch.warnInsufficient')}</p>
            )}
          </div>
        )}

        {/* Detection honesty — a poll-degraded deal search is not sniping-grade */}
        {state !== null && (
          <p className={`flex items-center gap-1.5 text-xs ${detectionDisplay.textClass}`}>
            <span
              aria-hidden
              className={`inline-block h-1.5 w-1.5 rounded-full ${detectionDisplay.dotClass}`}
            />
            {t(detectionDisplay.labelKey)}
          </p>
        )}

        {declinedKey !== null && <p className="text-xs text-warn">{t(declinedKey)}</p>}
        {errorMessage !== null && <p className="text-xs text-danger">{errorMessage}</p>}

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            disabled={saving || !thresholdValid}
            onClick={() => void save()}
          >
            {state !== null ? t('common.save') : t('dealWatch.enableCta')}
          </Button>
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
        </div>
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
    </section>
  );
}
