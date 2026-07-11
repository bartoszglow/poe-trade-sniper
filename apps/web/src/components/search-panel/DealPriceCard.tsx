import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  BASELINE_SAMPLE_SIZE_MAX,
  BASELINE_SAMPLE_SIZE_MIN,
  DEFAULT_BASELINE_SAMPLE_SIZE,
  type DealWatchMode,
  type DealWatchUnit,
  type SearchRuntimeInfo,
} from '@poe-sniper/shared';
import { useT } from '../../i18n/i18n';
import type { MessageKey } from '../../i18n/messages';
import { ApiError } from '../../lib/api';
import { requestDealRefresh, type DealRefreshDeclinedCode } from '../../lib/deal-watch-api';
import {
  DEAL_DOT_CLASSES,
  DEAL_PATCH_ERROR_KEYS,
  DEAL_STATUS_DISPLAY,
  computeClientCutoffExalted,
  cutoffExaltedForState,
  dealDefinitionOf,
  dealQueryPinsItem,
  formatExaltedAmount,
  formatExaltedDetailed,
} from '../../lib/deal-watch-display';
import { formatPriceAmount } from '../../lib/format-price';
import { formatRelativeMagnitude } from '../../lib/relative-time';
import type { UpdateSearchPayload } from '../../hooks/useSearches';
import { Button } from '../Button';
import { ConfirmDialog } from '../ConfirmDialog';
import { DealConfigFields } from './DealConfigFields';

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
  /** Display-only divine rate, snapshotted server-side at the last refresh;
   *  in enable state the market snapshot's rate stands in (D-dw-14). */
  const divineRate = state?.divinePriceExalted ?? search.marketPrice?.divinePriceExalted ?? null;

  const [draftMode, setDraftMode] = useState<DealWatchMode>(state?.mode ?? 'percent');
  const [draftThreshold, setDraftThreshold] = useState(
    state !== null ? String(state.thresholdValue) : '30',
  );
  const [draftUnit, setDraftUnit] = useState<DealWatchUnit>(state?.unit ?? 'exalted');
  const [draftSampleSize, setDraftSampleSize] = useState(
    String(state?.baselineSampleSize ?? DEFAULT_BASELINE_SAMPLE_SIZE),
  );
  const [draftRefreshIntervalMs, setDraftRefreshIntervalMs] = useState<number | null>(
    state?.refreshIntervalMs ?? null,
  );
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

  const parsedSampleSize = Number(draftSampleSize);
  const sampleSizeValid =
    Number.isInteger(parsedSampleSize) &&
    parsedSampleSize >= BASELINE_SAMPLE_SIZE_MIN &&
    parsedSampleSize <= BASELINE_SAMPLE_SIZE_MAX;

  // Enable state has no deal baseline yet — the market snapshot (D-dw-14) drives
  // the cutoff preview so the operator sees the would-be buy-below beforehand.
  const baselineExalted =
    state?.baseline?.amountExalted ?? search.marketPrice?.baseline.amountExalted ?? null;
  const cutoffExalted = thresholdValid
    ? computeClientCutoffExalted(
        { mode: draftMode, thresholdValue: parsedThreshold, unit: draftUnit },
        baselineExalted,
        divineRate,
      )
    : null;

  // The ACTIVE buy-below price (persisted config, not the draft). This is the deal
  // CUTOFF (baseline − threshold) — NOT state.capExalted, which is the GGG price
  // FILTER cap (cutoff × the +margin buffer that keeps the derived id stable), plan 46.
  const persistedCutoffExalted = state === null ? null : cutoffExaltedForState(state);

  const broadQuery = !dealQueryPinsItem(dealDefinitionOf(state, search.filters));
  const statusDisplay = state !== null ? DEAL_STATUS_DISPLAY[state.status] : null;
  const detectionDisplay = DETECTION_DISPLAY[search.engine ?? 'none'];
  const cooldownSecondsLeft =
    refreshRetryAtMs !== null ? Math.max(0, Math.ceil((refreshRetryAtMs - nowMs) / 1_000)) : 0;

  // Save is gated on a dirty form: enabling is always actionable, but an
  // unchanged config must not offer a Save that would spend GGG budget.
  const dirty =
    state === null ||
    draftMode !== state.mode ||
    parsedThreshold !== state.thresholdValue ||
    (draftMode === 'absolute' && draftUnit !== state.unit) ||
    (sampleSizeValid && parsedSampleSize !== state.baselineSampleSize) ||
    draftRefreshIntervalMs !== state.refreshIntervalMs;

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
    if (!thresholdValid || !sampleSizeValid || !dirty) return;
    setSaving(true);
    setErrorMessage(null);
    try {
      // The unit only means something in absolute mode (D-dw-11); percent
      // omits it so the server keeps its default.
      await onUpdate({
        dealWatch:
          draftMode === 'absolute'
            ? {
                mode: draftMode,
                thresholdValue: parsedThreshold,
                unit: draftUnit,
                baselineSampleSize: parsedSampleSize,
                refreshIntervalMs: draftRefreshIntervalMs,
              }
            : {
                mode: draftMode,
                thresholdValue: parsedThreshold,
                baselineSampleSize: parsedSampleSize,
                refreshIntervalMs: draftRefreshIntervalMs,
              },
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
          <span className="flex items-center gap-1.5 text-[11px] text-ink-muted">
            <span
              aria-hidden
              className={`inline-block h-1.5 w-1.5 rounded-full ${DEAL_DOT_CLASSES[statusDisplay.dotState]}`}
            />
            {t(statusDisplay.labelKey)}
          </span>
        )}
      </div>

      <div className="mt-3 space-y-3">
        {state === null && (
          <p className="text-xs leading-snug text-ink-muted">{t('dealWatch.enableIntro')}</p>
        )}
        {/* Enable state: show the already-known market price (D-dw-14) so the
            operator sees what a cutoff would compare against BEFORE enabling. */}
        {state === null && search.marketPrice !== null && (
          <p className="text-xs text-ink-muted">
            {t('dealWatch.enableMarket', {
              price: formatExaltedAmount(
                search.marketPrice.baseline.amountExalted,
                search.marketPrice.divinePriceExalted,
              ),
              time: formatRelativeMagnitude(search.marketPrice.baseline.computedAt, nowMs),
            })}
          </p>
        )}
        {broadQuery && (
          <p className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
            {t('dealWatch.broadQuery')}
          </p>
        )}

        {/* Shared with the add-search form (D-dw-16) — the surfaces must not drift. */}
        <DealConfigFields
          mode={draftMode}
          onModeChange={setDraftMode}
          threshold={draftThreshold}
          onThresholdChange={setDraftThreshold}
          unit={draftUnit}
          onUnitChange={setDraftUnit}
          sampleSize={draftSampleSize}
          onSampleSizeChange={setDraftSampleSize}
          sampleSizeValid={sampleSizeValid}
          refreshIntervalMs={draftRefreshIntervalMs}
          onRefreshIntervalChange={setDraftRefreshIntervalMs}
        />

        {/* The alert line previews the DRAFT config — once saved, the BUY BELOW
            stat carries the same number, so a clean form drops the duplicate. */}
        {thresholdValid && dirty && (
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

        {/* Baseline stats — plain on the card surface (no nested frames) */}
        {state !== null && (
          <div>
            {state.baseline !== null ? (
              <>
                <dl className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-x-5 gap-y-3">
                  <div>
                    <dt className="text-[10px] tracking-wide text-ink-faint uppercase">
                      {t('dealWatch.baselineValue')}
                    </dt>
                    <dd className="mt-0.5 font-mono text-[15px] leading-tight font-semibold text-gold-bright tabular-nums">
                      {renderDetailedAmount(state.baseline.amountExalted, divineRate)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] tracking-wide text-ink-faint uppercase">
                      {t('dealWatch.rawLowest')}
                    </dt>
                    <dd className="mt-0.5 font-mono text-[15px] leading-tight font-semibold text-ink tabular-nums">
                      {renderDetailedAmount(state.baseline.rawLowestExalted, divineRate)}
                    </dd>
                  </div>
                  {persistedCutoffExalted !== null && (
                    <div>
                      <dt className="text-[10px] tracking-wide text-ink-faint uppercase">
                        {t('dealWatch.buyBelow')}
                      </dt>
                      <dd className="mt-0.5 font-mono text-[15px] leading-tight font-semibold text-gold-bright tabular-nums">
                        {renderDetailedAmount(persistedCutoffExalted, divineRate)}
                      </dd>
                    </div>
                  )}
                </dl>
                <p className="mt-2 text-[11px] text-ink-faint">
                  {t('dealWatch.checkedAgo', {
                    time: formatRelativeMagnitude(state.baseline.computedAt, nowMs),
                  })}
                  {' · '}
                  {t('dealWatch.sampleOf', {
                    sample: state.baseline.sampleSize,
                    seen: state.baseline.listingsSeen,
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

        {/* Actions: refresh left · destructive disable centered between the two
            safe actions · save bottom-right (operator layout). Enable mode has
            only Save, kept right via ml-auto. */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {state !== null && (
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
          )}
          {state !== null && (
            <Button
              variant="ghost"
              className="text-danger hover:text-danger"
              onClick={() => setConfirmingDisable(true)}
            >
              {t('dealWatch.disableCta')}
            </Button>
          )}
          <Button
            variant="primary"
            className={state === null ? 'ml-auto' : undefined}
            disabled={saving || !thresholdValid || !sampleSizeValid || !dirty}
            onClick={() => void save()}
          >
            {state !== null ? t('common.save') : t('dealWatch.enableCta')}
          </Button>
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
