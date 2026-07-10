import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Archive,
  ArchiveRestore,
  ExternalLink,
  Folder,
  FolderPlus,
  GripVertical,
  ListFilter,
  Loader2,
  LogIn,
  Plus,
  Settings as SettingsIcon,
  Trash2,
} from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  TouchSensor,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  BASELINE_SAMPLE_SIZE_MAX,
  BASELINE_SAMPLE_SIZE_MIN,
  DEFAULT_BASELINE_SAMPLE_SIZE,
  tradeSearchPageUrl,
  type DealWatchMode,
  type DealWatchUnit,
  type EngineStatus,
  type EngineStatusDetailCode,
  type SearchLayoutEntry,
  type SearchPreview,
  type SearchRuntimeInfo,
} from '@poe-sniper/shared';
import { Badge, type BadgeTone } from '../components/Badge';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DealWatchControl } from '../components/DealWatchControl';
import { Field } from '../components/Field';
import { IconButton, IconLink } from '../components/IconButton';
import { QueryCriteriaView } from '../components/QueryCriteriaView';
import { DealConfigFields } from '../components/search-panel/DealConfigFields';
import {
  SearchDetailPanel,
  type PanelScrollTarget,
  type PanelSection,
} from '../components/search-panel/SearchDetailPanel';
import { RoomSection } from '../components/RoomSection';
import { Select } from '../components/Select';
import { Tooltip } from '../components/Tooltip';
import { Switch } from '../components/Switch';
import { TextInput } from '../components/TextInput';
import { useLeagues } from '../hooks/useLeagues';
import { useDetection } from '../hooks/useDetection';
import { usePanelExpansion } from '../hooks/usePanelExpansion';
import { useEventStream } from '../hooks/EventStreamProvider';
import { useSearches, type AddSearchPayload, type UpdateSearchPayload } from '../hooks/useSearches';
import { useServerStatus } from '../hooks/useServerStatus';
import { useT, useTn } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';
import { formatApproxMarketPrice } from '../lib/market-price';
import { formatRelativeMagnitude } from '../lib/relative-time';
import { resolveBuyControl, type BuyControl } from '../lib/resolve-buy-control';
import { shouldRowClickExpand } from '../lib/row-expand';
import { duplicatedAddedAts, stableRowKey } from '../lib/search-row-key';
import { ApiError, apiSend } from '../lib/api';
import { GettingStartedCard } from '../components/GettingStartedCard';
import { deriveGettingStarted } from '../lib/getting-started';
import { setGettingStartedDismissed } from '../lib/onboarding';
import { useOnboardingState } from '../hooks/useOnboardingState';
import {
  locateSearch,
  moveRoom,
  moveSearch,
  reorderWithinContainer,
  roomIdFromDndId,
  roomDragId,
} from '../lib/search-layout-dnd';
import {
  isRoomVisuallyCollapsed,
  pruneSuppressedRooms,
  readSuppressedRoomIds,
  suppressRoomAutoExpand,
  writeSuppressedRoomIds,
} from '../lib/room-auto-expand';
import {
  SEARCH_HIGHLIGHT_MS,
  clearSearchSpotlight,
  isSpotlightFresh,
} from '../lib/search-spotlight';
import type { SearchSpotlight } from '../lib/search-spotlight';
import { useSearchSpotlight } from '../hooks/useSearchSpotlight';

/** A search row glows for ~this long after one of its hits lands in the live
 *  feed — the shared constant also times the click-to-locate spotlight. */
const HIGHLIGHT_MS = SEARCH_HIGHLIGHT_MS;
const HIGHLIGHT_TICK_MS = 5_000;

const STATUS_TONES: Record<EngineStatus, BadgeTone> = {
  pending: 'neutral',
  connecting: 'info',
  active: 'ok',
  // degraded = amber/warn (matches the toggle + room breakdown); halted is the
  // lone loudest danger so the two are distinguishable on the row (review F10).
  degraded: 'warn',
  halted: 'danger',
  stopped: 'neutral',
  paused: 'info',
};

const STATUS_LABEL_KEYS: Record<EngineStatus, MessageKey> = {
  pending: 'engineStatus.pending',
  connecting: 'engineStatus.connecting',
  active: 'engineStatus.active',
  degraded: 'engineStatus.degraded',
  halted: 'engineStatus.halted',
  stopped: 'engineStatus.stopped',
  paused: 'engineStatus.paused',
};

/** Hover-popover explanations for each status badge. */
const STATUS_DESC_KEYS: Record<EngineStatus, MessageKey> = {
  pending: 'engineStatusDesc.pending',
  connecting: 'engineStatusDesc.connecting',
  active: 'engineStatusDesc.active',
  degraded: 'engineStatusDesc.degraded',
  halted: 'engineStatusDesc.halted',
  stopped: 'engineStatusDesc.stopped',
  paused: 'engineStatusDesc.paused',
};

/**
 * Whether a status's detail line adds anything beyond its badge. active / paused /
 * stopped are fully described by the badge itself, so their detail ("paused",
 * "live websocket connected") is just noise; degraded / connecting / pending carry
 * a real reason worth surfacing. Exhaustive on purpose — a new EngineStatus won't
 * compile until it declares its intent here.
 */
const STATUS_SHOWS_DETAIL: Record<EngineStatus, boolean> = {
  pending: true,
  connecting: true,
  active: false,
  degraded: true,
  halted: true,
  stopped: false,
  paused: false,
};

/**
 * Localized label for a degraded status's stable detail CODE. The server emits a
 * code (EngineStatusDetailCode), never raw prose or a WS close code; an unmapped
 * value (e.g. a legacy raw string) renders nothing rather than leaking to the user.
 */
const STATUS_DETAIL_KEYS: Partial<Record<EngineStatusDetailCode, MessageKey>> = {
  'no-session': 'engineDetail.noSession',
  'guard-halted': 'engineDetail.guardHalted',
  'ws-rate-limited': 'engineDetail.wsRateLimited',
  'ws-reconnecting': 'engineDetail.wsReconnecting',
  'ws-unstable': 'engineDetail.wsUnstable',
  'rate-limited': 'engineDetail.rateLimited',
  error: 'engineDetail.error',
};

/** The localized detail key for a search's status, or null when nothing should show
 *  (the status hides its detail, or the value isn't a known code — never raw text). */
function statusDetailKey(status: EngineStatus, detail: string | null): MessageKey | null {
  if (!detail || !STATUS_SHOWS_DETAIL[status]) return null;
  return STATUS_DETAIL_KEYS[detail as EngineStatusDetailCode] ?? null;
}

function AddSearchForm({ onAdd }: { onAdd: (payload: AddSearchPayload) => Promise<void> }) {
  const t = useT();
  const { leagues } = useLeagues();
  const [input, setInput] = useState('');
  const [label, setLabel] = useState('');
  const [league, setLeague] = useState('');
  const [autoTravel, setAutoTravel] = useState(false);
  // Deal watch at add time (D-dw-16) — off by default; the fields reveal on toggle.
  const [dealEnabled, setDealEnabled] = useState(false);
  const [dealMode, setDealMode] = useState<DealWatchMode>('percent');
  const [dealThreshold, setDealThreshold] = useState('');
  const [dealUnit, setDealUnit] = useState<DealWatchUnit>('exalted');
  const [dealSampleSize, setDealSampleSize] = useState(String(DEFAULT_BASELINE_SAMPLE_SIZE));
  const [dealRefreshIntervalMs, setDealRefreshIntervalMs] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [previewQuery, setPreviewQuery] = useState<unknown>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  // Start COLLAPSED — the Searches view opens showing just the "add" CTA; the form
  // expands on click (and tucks away again on click-outside / after a successful add).
  const [collapsed, setCollapsed] = useState(true);
  const formRef = useRef<HTMLFormElement>(null);

  // Any pointer-down OUTSIDE the expanded form tucks it away (click-outside,
  // same pattern as Select) — focus-based blur alone misses the case where the
  // form is expanded but no field has been focused yet. Draft state survives;
  // reopening shows it again. Alt-tabbing out fires no in-page pointerdown, so
  // copying the trade URL from another window keeps the form open.
  useEffect(() => {
    if (collapsed) return;
    const onPointerDown = (pointerEvent: MouseEvent) => {
      if (formRef.current && !formRef.current.contains(pointerEvent.target as Node)) {
        setCollapsed(true);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [collapsed]);

  // The URL is the source of truth for league + purchase type (D-14).
  // Only a bare id needs a league — the resolve endpoint takes it in the path.
  const trimmedInput = input.trim();
  const inputIsBareId = trimmedInput !== '' && !/^(https?|wss?):\/\//.test(trimmedInput);

  // Deal-config validation mirrors the panel card: threshold > 0 (and < 100 for
  // percent), sample size within bounds. Only gates submit while deal is on.
  const parsedDealThreshold = Number(dealThreshold);
  const dealThresholdValid =
    dealThreshold.trim() !== '' &&
    Number.isFinite(parsedDealThreshold) &&
    parsedDealThreshold > 0 &&
    (dealMode !== 'percent' || parsedDealThreshold < 100);
  const parsedDealSampleSize = Number(dealSampleSize);
  const dealSampleSizeValid =
    Number.isInteger(parsedDealSampleSize) &&
    parsedDealSampleSize >= BASELINE_SAMPLE_SIZE_MIN &&
    parsedDealSampleSize <= BASELINE_SAMPLE_SIZE_MAX;
  const dealConfigInvalid = dealEnabled && (!dealThresholdValid || !dealSampleSizeValid);

  async function togglePreview(): Promise<void> {
    if (previewOpen) {
      setPreviewOpen(false);
      return;
    }
    setPreviewLoading(true);
    setErrorMessage(null);
    try {
      const preview = await apiSend<SearchPreview>('POST', '/api/searches/preview', {
        input: trimmedInput,
        league: inputIsBareId ? league.trim() || leagues[0]?.id || undefined : undefined,
      });
      setPreviewQuery(preview.query);
      setPreviewOpen(true);
    } catch (error) {
      setErrorMessage(
        error instanceof ApiError && error.userFacing ? error.message : t('common.requestFailed'),
      );
    } finally {
      setPreviewLoading(false);
    }
  }

  async function submit(formEvent: FormEvent) {
    formEvent.preventDefault();
    setSubmitting(true);
    setErrorMessage(null);
    // The select shows the first league before any change — submit must match.
    const effectiveLeague = inputIsBareId
      ? league.trim() || leagues[0]?.id || undefined
      : undefined;
    try {
      await onAdd({
        input: trimmedInput,
        label: label.trim() || undefined,
        league: effectiveLeague,
        autoTravel,
        // D-dw-16: arm deal mode in the same request when the subsection is on.
        dealWatch:
          dealEnabled && dealThresholdValid && dealSampleSizeValid
            ? {
                mode: dealMode,
                thresholdValue: parsedDealThreshold,
                unit: dealUnit,
                baselineSampleSize: parsedDealSampleSize,
                refreshIntervalMs: dealRefreshIntervalMs,
              }
            : undefined,
      });
      resetAndClose();
    } catch (error) {
      // A deal-coded 409 (stackable / cap reached) means the SEARCH WAS created
      // and only the deal part was refused — the row now shows that deal status,
      // so close the form as for a normal add rather than trapping the operator.
      if (error instanceof ApiError && error.code?.startsWith('deal-')) {
        resetAndClose();
      } else {
        setErrorMessage(
          error instanceof ApiError && error.userFacing ? error.message : t('common.requestFailed'),
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  function resetAndClose(): void {
    setInput('');
    setLabel('');
    setAutoTravel(false);
    setDealEnabled(false);
    setDealMode('percent');
    setDealThreshold('');
    setDealUnit('exalted');
    setDealSampleSize(String(DEFAULT_BASELINE_SAMPLE_SIZE));
    setDealRefreshIntervalMs(null);
    // Collapse the form (and any open preview) so the search list isn't pushed
    // down by the editor — it reopens on click.
    setPreviewOpen(false);
    setPreviewQuery(null);
    setCollapsed(true);
  }

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="flex w-full items-center gap-2 rounded-lg border border-dashed border-edge bg-surface-1 px-4 py-2.5 text-sm text-ink-muted transition-colors hover:text-ink"
      >
        <Plus className="h-4 w-4" />
        {t('searches.addCta')}
      </button>
    );
  }

  return (
    <form
      ref={formRef}
      onSubmit={(formEvent) => void submit(formEvent)}
      onBlur={(blurEvent) => {
        // Keyboard path: tabbing out of the form collapses it too.
        const focusMovedTo = blurEvent.relatedTarget as Node | null;
        if (!blurEvent.currentTarget.contains(focusMovedTo) && document.hasFocus()) {
          setCollapsed(true);
        }
      }}
      className="rounded-lg border border-edge bg-surface-1 p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('searches.fieldInput')} hint={t('searches.fieldInputHint')}>
          <TextInput
            value={input}
            onChange={(changeEvent) => {
              setInput(changeEvent.target.value);
              // A different input means a different query — the preview is stale.
              setPreviewOpen(false);
              setPreviewQuery(null);
            }}
            placeholder={t('searches.fieldInputPlaceholder')}
            required
          />
        </Field>
        <Field label={t('searches.fieldLabel')}>
          <TextInput
            value={label}
            onChange={(changeEvent) => setLabel(changeEvent.target.value)}
            placeholder={t('searches.fieldLabelPlaceholder')}
          />
        </Field>
        {inputIsBareId && (
          <Field label={t('searches.fieldLeague')} hint={t('searches.fieldLeagueHint')}>
            {leagues.length > 0 ? (
              <Select
                value={league || (leagues[0]?.id ?? '')}
                onChange={setLeague}
                options={leagues.map((leagueInfo) => ({
                  value: leagueInfo.id,
                  label: leagueInfo.text,
                }))}
              />
            ) : (
              <TextInput
                value={league}
                onChange={(changeEvent) => setLeague(changeEvent.target.value)}
                placeholder="Standard"
              />
            )}
          </Field>
        )}
      </div>
      {previewOpen && previewQuery !== null && (
        <div className="mt-3 rounded-md border border-edge bg-surface-1 p-3">
          <QueryCriteriaView query={previewQuery} />
        </div>
      )}
      {/* Optional deal watch at add time (D-dw-16) — same field group as the
          panel card; off by default, so a plain add is unchanged. */}
      <div className="mt-3 rounded-md border border-edge bg-surface-1 p-3">
        <span className="flex items-center gap-2 text-sm text-ink-muted">
          <Switch
            checked={dealEnabled}
            onChange={setDealEnabled}
            label={t('searches.dealSetupToggle')}
          />
          {t('searches.dealSetupToggle')}
        </span>
        {dealEnabled && (
          <div className="mt-3 flex flex-col gap-3">
            <DealConfigFields
              mode={dealMode}
              onModeChange={setDealMode}
              threshold={dealThreshold}
              onThresholdChange={setDealThreshold}
              unit={dealUnit}
              onUnitChange={setDealUnit}
              sampleSize={dealSampleSize}
              onSampleSizeChange={setDealSampleSize}
              sampleSizeValid={dealSampleSizeValid}
              refreshIntervalMs={dealRefreshIntervalMs}
              onRefreshIntervalChange={setDealRefreshIntervalMs}
            />
            <p className="text-xs text-ink-faint">{t('dealWatch.summaryPending')}</p>
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <span className="flex items-center gap-2 text-sm text-ink-muted">
          <Switch checked={autoTravel} onChange={setAutoTravel} label={t('searches.autoTravel')} />
          {t('searches.autoTravelInline')}
          {autoTravel && (
            <span className="text-xs text-warn">{t('searches.autoTravelWarning')}</span>
          )}
        </span>
        <div className="flex-1" />
        {errorMessage && <span className="text-sm text-danger">{errorMessage}</span>}
        <Button
          variant="ghost"
          type="button"
          disabled={trimmedInput === '' || previewLoading}
          onClick={() => void togglePreview()}
        >
          <ListFilter className="h-4 w-4" />
          {previewLoading
            ? t('criteria.loading')
            : previewOpen
              ? t('criteria.hide')
              : t('criteria.show')}
        </Button>
        <Button
          variant="primary"
          type="submit"
          disabled={submitting || input.trim() === '' || dealConfigInvalid}
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {submitting ? t('searches.adding') : t('searches.watch')}
        </Button>
      </div>
    </form>
  );
}

function SearchRow({
  search,
  buyControl,
  highlighted,
  detectionPaused,
  spotlitAt,
  nowMs,
  onUpdate,
  onRemove,
  onRestart,
  onPanelOpenChange,
}: {
  search: SearchRuntimeInfo;
  buyControl: BuyControl;
  highlighted: boolean;
  /** Global detection pause — TRAVEL/BUY are inert then, so they grey out
   *  (still togglable: configuring while paused is fine, nothing fires). */
  detectionPaused: boolean;
  /** Fresh locate-click timestamp for THIS row (Q3) — auto-opens the panel. */
  spotlitAt: number | null;
  /** The page's ticking clock — drives the "degraded for Xm" duration. */
  nowMs: number;
  onUpdate: (payload: UpdateSearchPayload) => Promise<void>;
  onRemove: () => Promise<void>;
  /** Manual detection restart (plan 43, D-deg-4). */
  onRestart: () => Promise<void>;
  /** Report detail-panel open/close up to the page so an open panel keeps its
   *  auto-expanded room from folding out from under it (D-room-3). */
  onPanelOpenChange?: (searchId: string, open: boolean) => void;
}) {
  const t = useT();
  const tn = useTn();
  // The unified detail panel (plan 42): the expand/collapse state machine is
  // the shared usePanelExpansion hook; only the scroll target stays local.
  const { panelRendered, panelShown, openPanel: expandPanel, togglePanel } = usePanelExpansion();
  const [scrollTarget, setScrollTarget] = useState<PanelScrollTarget | null>(null);
  function openPanel(section: PanelSection | null): void {
    expandPanel();
    setScrollTarget(section === null ? null : { section, token: Date.now() });
  }
  // Keep the page's open-panel registry in sync — including on unmount (a manual
  // room collapse destroys this row), so a closed/gone panel never wedges the guard.
  useEffect(() => {
    onPanelOpenChange?.(search.id, panelShown);
    return () => onPanelOpenChange?.(search.id, false);
  }, [panelShown, search.id, onPanelOpenChange]);
  // Q3: a fresh locate-click on a deal-mode row opens its panel at the deal
  // card. Adjust-during-render (not an effect — the repo forbids set-state in
  // effects): a state flag dedupes so each distinct spotlight timestamp fires
  // once (the draftsSyncedForOpen pattern used elsewhere in this file).
  const hasDealWatch = search.dealWatch !== null;
  const [handledSpotlightAt, setHandledSpotlightAt] = useState<number | null>(null);
  if (spotlitAt !== null && hasDealWatch && handledSpotlightAt !== spotlitAt) {
    setHandledSpotlightAt(spotlitAt);
    expandPanel();
    setScrollTarget({ section: 'deal', token: spotlitAt });
  }
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Approximate market price (D-dw-14) — deal rows compose it from their live
  // baseline server-side, so one field covers every row.
  const marketPriceLabel = formatApproxMarketPrice(search.marketPrice);
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: search.id,
  });

  async function run(action: () => Promise<void>) {
    setErrorMessage(null);
    try {
      await action();
    } catch (error) {
      setErrorMessage(
        error instanceof ApiError && error.userFacing ? error.message : t('common.requestFailed'),
      );
    }
  }

  const detailKey = statusDetailKey(search.status, search.statusDetail);
  // Row is actively detecting unless globally paused or disabled ('stopped') —
  // drives whether the armed TRAVEL/BUY tags show or collapse to PAUSE.
  const rowRunning = search.status !== 'paused' && search.status !== 'stopped';

  return (
    <li
      ref={setNodeRef}
      data-search-row={search.id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-lg border px-4 py-3 transition-colors ${
        isDragging
          ? 'border-gold/40 opacity-40'
          : highlighted
            ? 'border-gold/60 bg-gold/5'
            : 'border-edge bg-surface-1'
      }`}
    >
      {/* D-42-1: the whole header toggles the panel; interactive controls,
          portal (ConfirmDialog) clicks, and text-selection drags are excluded
          via the shared guard, so switches/buttons/copying behave as before. */}
      <div
        className="flex cursor-pointer flex-wrap items-center gap-3"
        onClick={(clickEvent) => {
          if (
            shouldRowClickExpand(clickEvent.currentTarget, clickEvent.target, window.getSelection())
          ) {
            togglePanel();
          }
        }}
      >
        <button
          type="button"
          data-no-expand
          aria-label={t('searches.reorder')}
          title={t('searches.reorder')}
          className="shrink-0 cursor-grab touch-none text-ink-faint transition-colors hover:text-ink active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-ink">{search.label}</span>
            <IconLink
              variant="ghost"
              href={tradeSearchPageUrl(search.realm, search.league, search.id)}
              target="_blank"
              rel="noreferrer"
              aria-label={t('searches.openOnTradeSite')}
              title={t('searches.openOnTradeSite')}
            >
              <ExternalLink className="h-3 w-3" />
            </IconLink>
            <Tooltip content={t(STATUS_DESC_KEYS[search.status])}>
              <Badge tone={STATUS_TONES[search.status]}>
                {t(STATUS_LABEL_KEYS[search.status])}
              </Badge>
            </Tooltip>
            {search.engine && (
              <Tooltip
                content={t(search.engine === 'ws' ? 'detection.wsTitle' : 'detection.pollTitle')}
              >
                <Badge tone={search.engine === 'ws' ? 'gold' : 'neutral'}>{search.engine}</Badge>
              </Tooltip>
            )}
          </div>
          <div className="mt-0.5 text-xs text-ink-faint">
            {search.id} · {search.league} · {tn('searches.hitCount', search.hitCount)}
            {search.lastHitAt &&
              ` · ${t('searches.last', { time: new Date(search.lastHitAt).toLocaleTimeString() })}`}
            {marketPriceLabel !== null && (
              <Tooltip
                content={t('searches.marketPriceTip', {
                  sample: search.marketPrice!.baseline.sampleSize,
                })}
              >
                <span className="ml-1 text-ink-muted"> · {marketPriceLabel}</span>
              </Tooltip>
            )}
          </div>
        </div>
        <div className="flex-1" />
        <DealWatchControl search={search} onExpandDeal={() => openPanel('deal')} />
        {/* Automation state tags (operator iteration 2026-07-05) — same badge
            family as WS/POLL. When the row is not detecting (global pause or
            disabled) the armed TRAVEL/BUY tags collapse to a single PAUSE tag. */}
        {rowRunning ? (
          <>
            {search.autoTravel && (
              <Tooltip content={t('searches.travelDesc')}>
                <Badge tone="gold">{t('searches.travelToggle')}</Badge>
              </Tooltip>
            )}
            {search.autoBuy && (
              <Tooltip content={t('searches.buyDesc')}>
                <Badge tone="gold">{t('searches.buyToggle')}</Badge>
              </Tooltip>
            )}
          </>
        ) : (
          <Badge tone="info">{t('searches.pausedTag')}</Badge>
        )}
        <span className="flex items-center gap-1.5 text-xs text-ink-muted">
          <Switch
            checked={search.enabled}
            onChange={(checked) => void run(() => onUpdate({ enabled: checked }))}
            label={t('searches.activeFor', { label: search.label })}
            // Option B (plan 44): position = intent, colour = truth — gold only
            // while actually running; blue under a pause gate; amber otherwise
            // (starting/degraded/halted: on, but not detecting).
            tone={
              search.status === 'active' ? 'gold' : search.status === 'paused' ? 'info' : 'warn'
            }
          />
          {t('searches.activeToggle')}
        </span>
        <IconButton
          variant="ghost"
          aria-label={panelShown ? t('searches.detailsHide') : t('searches.detailsShow')}
          title={panelShown ? t('searches.detailsHide') : t('searches.detailsShow')}
          aria-expanded={panelShown}
          className={panelShown ? 'text-gold' : undefined}
          onClick={togglePanel}
        >
          <ListFilter className="h-4 w-4" />
        </IconButton>
      </div>
      {/* Surface the status detail only when it adds something the badge doesn't
          (see statusDetailKey / STATUS_SHOWS_DETAIL) — active/paused/stopped are
          already fully said by the badge, and a raw/unmapped detail is never shown.
          A sticky degraded (plan 43) also says HOW LONG it has been broken. */}
      {detailKey && (
        <div className="mt-1.5 text-xs text-ink-faint">
          {t(detailKey)}
          {search.degradedSince !== null &&
            ` · ${t('searches.degradedFor', {
              time: formatRelativeMagnitude(search.degradedSince, nowMs),
            })}`}
        </div>
      )}
      {errorMessage && <div className="mt-1.5 text-xs text-danger">{errorMessage}</div>}
      {/* Animated expand/collapse (D-42-1): grid 0fr→1fr height transition,
          ~200ms ease-out, disabled under prefers-reduced-motion. */}
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${
          panelShown ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          {panelRendered && (
            <div className="mt-2 border-t border-edge pt-3">
              <SearchDetailPanel
                search={search}
                detectionPaused={detectionPaused}
                buyControl={buyControl}
                onUpdate={onUpdate}
                onRemove={onRemove}
                onRestart={onRestart}
                scrollTarget={scrollTarget}
              />
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * One archived search (#35): greyed, outside the DnD layout, restore or delete
 * only — every toggle and the room membership survive server-side for restore.
 */
function ArchivedSearchRow({
  search,
  highlighted,
  onRestore,
  onRemove,
}: {
  search: SearchRuntimeInfo;
  /** The click-to-locate spotlight can target an archived search too. */
  highlighted: boolean;
  onRestore: () => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const t = useT();
  const tn = useTn();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // D-42-1 applies to archived rows too — the panel shows the item criteria
  // only (an archived search has no detection, no deal actions to offer).
  const { panelRendered, panelShown, togglePanel } = usePanelExpansion();

  async function run(action: () => Promise<void>) {
    setErrorMessage(null);
    try {
      await action();
    } catch (error) {
      setErrorMessage(
        error instanceof ApiError && error.userFacing ? error.message : t('common.requestFailed'),
      );
    }
  }

  return (
    <li
      data-search-row={search.id}
      className={`rounded-lg border px-4 py-2.5 transition-opacity ${
        highlighted
          ? 'border-gold/60 bg-gold/5 opacity-90'
          : 'border-edge bg-surface-1 opacity-55 hover:opacity-85'
      }`}
    >
      <div
        className="flex cursor-pointer flex-wrap items-center gap-3"
        onClick={(clickEvent) => {
          if (
            shouldRowClickExpand(clickEvent.currentTarget, clickEvent.target, window.getSelection())
          ) {
            togglePanel();
          }
        }}
      >
        <Archive className="h-4 w-4 shrink-0 text-ink-faint" />
        <div className="min-w-0">
          <span className="truncate font-medium text-ink">{search.label}</span>
          <div className="mt-0.5 text-xs text-ink-faint">
            {search.id} · {search.league} · {tn('searches.hitCount', search.hitCount)}
            {search.archivedAt &&
              ` · ${t('searches.archivedOn', {
                time: new Date(search.archivedAt).toLocaleDateString(),
              })}`}
          </div>
        </div>
        <div className="flex-1" />
        {errorMessage && <span className="text-xs text-danger">{errorMessage}</span>}
        {/* The accessible expand toggle (D-42-1) — the row-wide click is a
            pointer convenience; keyboard/AT users get the same button as
            active rows. */}
        <IconButton
          variant="ghost"
          aria-label={panelShown ? t('searches.detailsHide') : t('searches.detailsShow')}
          title={panelShown ? t('searches.detailsHide') : t('searches.detailsShow')}
          aria-expanded={panelShown}
          className={panelShown ? 'text-gold' : undefined}
          onClick={togglePanel}
        >
          <ListFilter className="h-4 w-4" />
        </IconButton>
        <IconButton
          variant="ghost"
          aria-label={t('searches.restore', { label: search.label })}
          title={t('searches.restore', { label: search.label })}
          onClick={() => void run(onRestore)}
        >
          <ArchiveRestore className="h-4 w-4" />
        </IconButton>
        <IconButton
          variant="danger"
          aria-label={t('searches.remove', { label: search.label })}
          onClick={() => setConfirmingDelete(true)}
        >
          <Trash2 className="h-4 w-4" />
        </IconButton>
        <ConfirmDialog
          open={confirmingDelete}
          title={t('searches.deleteConfirmTitle')}
          body={t('searches.deleteConfirmBody', { label: search.label })}
          onClose={() => setConfirmingDelete(false)}
          actions={[
            { id: 'delete', label: t('common.delete'), onSelect: () => void run(onRemove) },
          ]}
        />
      </div>
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${
          panelShown ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          {panelRendered && (
            <div className="mt-2 border-t border-edge pt-3">
              <QueryCriteriaView query={search.filters} />
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * Login gate: without a valid GGG session there is nothing to add a search to,
 * so the form is replaced by a prominent prompt that routes to Settings (where
 * the in-app login lives). Shown for both "never logged in" and an expired
 * session — the same condition the boot LoginOverlay uses.
 */
function LoginRequired() {
  const t = useT();
  const navigate = useNavigate();
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-edge bg-surface-1 px-6 py-16 text-center">
      <div className="rounded-full border border-edge bg-surface-0 p-4">
        <LogIn className="h-8 w-8 text-gold" />
      </div>
      <h2 className="text-xl font-semibold text-ink">{t('searches.loginRequiredTitle')}</h2>
      <p className="max-w-md text-sm text-ink-muted">{t('searches.loginRequiredBody')}</p>
      <Button
        variant="primary"
        onClick={() => {
          void navigate('/settings');
        }}
      >
        <SettingsIcon className="h-4 w-4" />
        {t('searches.loginRequiredCta')}
      </Button>
    </div>
  );
}

/** Floating DragOverlay ghost for a dragged search — compact, never clipped. */
function SearchDragGhost({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-gold/70 bg-surface-1 px-4 py-3 shadow-lg">
      <GripVertical className="h-4 w-4 text-ink-faint" />
      <span className="truncate font-medium text-ink">{label}</span>
    </div>
  );
}

/** Floating DragOverlay ghost for a dragged room block. */
function RoomDragGhost({ name, memberCount }: { name: string; memberCount: number }) {
  const tn = useTn();
  return (
    <div className="flex items-center gap-3 rounded-lg border border-gold/70 bg-surface-0 px-4 py-2.5 shadow-lg">
      <GripVertical className="h-4 w-4 text-ink-faint" />
      <Folder className="h-4 w-4 text-ink-muted" />
      <span className="truncate font-medium text-ink">{name}</span>
      <Badge tone="neutral">{tn('rooms.memberCount', memberCount)}</Badge>
    </div>
  );
}

/**
 * pointerWithin gives precise container targeting while a pointer drags a
 * search into/out of rooms; closestCorners covers the keyboard sensor (no
 * pointer coordinates) — the standard dnd-kit multiple-containers pairing.
 */
const collisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCorners(args);
};

export function SearchesPage() {
  const t = useT();
  const { status } = useServerStatus();
  const {
    searches,
    rooms,
    layout,
    loaded,
    add,
    update,
    remove,
    restartSearch,
    reorderLayout,
    createRoom,
    updateRoom,
    removeRoom,
    setRoomEnabled,
  } = useSearches();
  const { paused, setDetectionPaused } = useDetection();
  const { lastHitAtBySearchId } = useEventStream();

  // Local layout copy so a drag rearranges instantly (optimistic); it re-syncs from the
  // server on every searches change (add/remove/reorder refetch) — done DURING render
  // (React's adjust-state-on-prop-change pattern), not in an effect. The server layout
  // IS the user's order now, so there's no client-side re-sort.
  const [layoutState, setLayoutState] = useState<SearchLayoutEntry[]>(layout);
  const [syncedLayout, setSyncedLayout] = useState(layout);
  if (layout !== syncedLayout) {
    setSyncedLayout(layout);
    setLayoutState(layout);
  }

  /**
   * The room to open in rename mode right after "New room" creates it.
   * RoomSection captures the flag as initial state on mount; the flag clears
   * when that rename commits (the common case) and dies with the page anyway —
   * so a rare list remount before the rename can at worst reopen the editor.
   */
  const [justCreatedRoomId, setJustCreatedRoomId] = useState<string | null>(null);

  // Re-render periodically so the ~60s "just found" row highlight ages out.
  // The tick SKIPS while the operator is mid-interaction — an active drag, or
  // typing in a form field — because aging out a room's window folds it and
  // unmounts its member rows (an open edit modal would lose its draft, drop
  // targets would shift under the pointer). Aging resumes on the next tick
  // after the interaction ends; highlights just linger a little longer.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const dragInFlightRef = useRef(false);
  // Searches whose criteria panel is open. An OPEN panel inside an auto-expanded
  // room must keep that room from folding when its hit-highlight window ages out
  // (D-room-3) — otherwise the member row unmounts and the panel snaps shut under
  // the operator. Reported up from each SearchRow (open + on unmount).
  const openPanelIdsRef = useRef<Set<string>>(new Set());
  const reportPanelOpen = useCallback((searchId: string, open: boolean): void => {
    if (open) openPanelIdsRef.current.add(searchId);
    else openPanelIdsRef.current.delete(searchId);
  }, []);
  useEffect(() => {
    const isOperatorMidInteraction = (): boolean => {
      if (dragInFlightRef.current) return true;
      if (openPanelIdsRef.current.size > 0) return true;
      const focused = document.activeElement;
      return (
        focused instanceof HTMLElement &&
        (focused.tagName === 'INPUT' || focused.tagName === 'TEXTAREA' || focused.isContentEditable)
      );
    };
    const timer = setInterval(() => {
      if (!isOperatorMidInteraction()) setNowMs(Date.now());
    }, HIGHLIGHT_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  const isHighlighted = (searchId: string): boolean => {
    const at = lastHitAtBySearchId[searchId];
    return at !== undefined && nowMs - new Date(at).getTime() < HIGHLIGHT_MS;
  };

  // Click-to-locate spotlight: clicking a live hit's search chip glows the
  // source row exactly like a fresh hit does (one at a time — a later click
  // replaces it; see search-spotlight.ts). Feeds the same "lit" predicate, so
  // a spotlighted member also auto-expands its collapsed room.
  const spotlight = useSearchSpotlight();
  const isSpotlighted = (searchId: string): boolean =>
    spotlight !== null && spotlight.searchId === searchId && isSpotlightFresh(spotlight, nowMs);
  const isSearchLit = (searchId: string): boolean =>
    isHighlighted(searchId) || isSpotlighted(searchId);

  // Variant-2 auto-expand (D-room-3): a collapsed room pops open while a member's
  // hit highlight is fresh and folds back when it ages out. All client-side —
  // the persisted `collapsed` never changes. Manually collapsing mid-window
  // suppresses the pop-open until that window fully expires. The suppression
  // set mirrors a session-scoped module store so a route change doesn't forget
  // it (the highlight window itself lives in the app-root EventStreamProvider).
  const [suppressedRoomIds, setSuppressedRoomIds] =
    useState<ReadonlySet<string>>(readSuppressedRoomIds);
  function suppressRoom(roomId: string): void {
    setSuppressedRoomIds(suppressRoomAutoExpand(roomId));
  }
  // Freshness derives from the SERVER-CONFIRMED layout, not the optimistic drag
  // preview — otherwise hovering a fresh search across a collapsed room would
  // flip its membership mid-drag and flap the room open/shut under the pointer.
  const freshRoomIds = new Set<string>();
  for (const entry of syncedLayout) {
    if (entry.kind !== 'room') continue;
    if (entry.searchIds.some((searchId) => isSearchLit(searchId))) freshRoomIds.add(entry.id);
  }
  // The spotlit search's room, resolved ONCE from the server-confirmed layout —
  // the suppression override and the chevron's clear-spotlight check must read
  // the SAME source, or a stale optimistic layout (e.g. a failed reorder POST)
  // lets them disagree and reopens the chevron fight.
  const spotlitRoomId =
    spotlight !== null && isSpotlightFresh(spotlight, nowMs)
      ? (syncedLayout.find(
          (entry) => entry.kind === 'room' && entry.searchIds.includes(spotlight.searchId),
        )?.id ?? null)
      : null;

  // Suppression ends with the window (adjust-during-render; null = no change).
  let adjustedSuppressed = pruneSuppressedRooms(suppressedRoomIds, freshRoomIds);
  // An explicit locate-click overrides a manual mid-window collapse — the
  // operator asked to SEE this search, so its room must open. No fight with
  // the chevron: collapsing the spotlit room dismisses the spotlight itself.
  if (spotlitRoomId !== null && (adjustedSuppressed ?? suppressedRoomIds).has(spotlitRoomId)) {
    const withoutSpotlitRoom = new Set(adjustedSuppressed ?? suppressedRoomIds);
    withoutSpotlitRoom.delete(spotlitRoomId);
    adjustedSuppressed = withoutSpotlitRoom;
  }
  if (adjustedSuppressed !== null) {
    writeSuppressedRoomIds(adjustedSuppressed);
    setSuppressedRoomIds(adjustedSuppressed);
  }

  // Bring the spotlighted row into view once it exists. The click usually
  // arrives from ANOTHER page: this component mounts with an empty layout and
  // the rows only render when the fetch lands — hence the syncedLayout dep
  // re-arms the effect until the row is actually in the DOM. The ref makes it
  // scroll once per click; the freshness guard keeps a long-expired spotlight
  // from scroll-jumping a later visit.
  const scrolledSpotlightRef = useRef<SearchSpotlight | null>(null);
  useEffect(() => {
    if (spotlight === null || !isSpotlightFresh(spotlight, Date.now())) return;
    if (scrolledSpotlightRef.current === spotlight) return;
    const row = document.querySelector(`[data-search-row="${spotlight.searchId}"]`);
    if (!row) return; // not rendered yet — the next syncedLayout change retries
    scrolledSpotlightRef.current = spotlight;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [spotlight, syncedLayout]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /** The id being dragged — drives the DragOverlay ghost + compact-rooms mode. */
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const isRoomDragActive = activeDragId !== null && roomIdFromDndId(activeDragId) !== null;
  // The room a dragged SEARCH is currently hovering (its `room:<id>`/`roomdrop:<id>`
  // block) — used to force-expand a collapsed room so the operator can drop BETWEEN
  // its members, not just append (#14).
  const [dragOverRoomId, setDragOverRoomId] = useState<string | null>(null);
  const activeDragSearchId =
    activeDragId !== null && roomIdFromDndId(activeDragId) === null ? activeDragId : null;
  const activeSearchRoomId =
    activeDragSearchId !== null
      ? (locateSearch(layoutState, activeDragSearchId)?.roomId ?? null)
      : null;

  function handleDragStart(event: DragStartEvent): void {
    dragInFlightRef.current = true;
    setActiveDragId(String(event.active.id));
  }

  /** Cross-container preview: a dragged SEARCH enters/leaves a room live. */
  function handleDragOver(event: DragOverEvent): void {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    if (roomIdFromDndId(activeId) !== null) return; // rooms settle on drop
    const overId = String(over.id);
    if (activeId === overId) return;
    const activeLocation = locateSearch(layoutState, activeId);
    if (!activeLocation) return;
    const overRoomId = roomIdFromDndId(overId);
    // Track the hovered room (null when over a bare search) so it force-expands.
    setDragOverRoomId(overRoomId);
    if (overRoomId !== null) {
      // Over a room block / its empty drop zone → append (works collapsed too).
      if (activeLocation.roomId === overRoomId) return;
      const roomEntry = layoutState.find(
        (entry) => entry.kind === 'room' && entry.id === overRoomId,
      );
      if (roomEntry?.kind !== 'room') return;
      setLayoutState(
        moveSearch(layoutState, activeId, {
          roomId: overRoomId,
          index: roomEntry.searchIds.length,
        }),
      );
      return;
    }
    const overLocation = locateSearch(layoutState, overId);
    if (!overLocation || overLocation.roomId === activeLocation.roomId) return;
    setLayoutState(moveSearch(layoutState, activeId, overLocation));
  }

  function handleDragEnd(event: DragEndEvent): void {
    const { active, over } = event;
    dragInFlightRef.current = false;
    setActiveDragId(null);
    setDragOverRoomId(null);
    const activeId = String(active.id);
    let next = layoutState;
    if (over) {
      const overId = String(over.id);
      const activeRoomId = roomIdFromDndId(activeId);
      if (activeRoomId !== null) {
        next = moveRoom(layoutState, activeRoomId, overId);
      } else if (activeId !== overId && roomIdFromDndId(overId) === null) {
        next = reorderWithinContainer(layoutState, activeId, overId);
      }
    }
    setLayoutState(next); // optimistic — the searches refetch reconciles
    if (JSON.stringify(next) === JSON.stringify(syncedLayout)) return; // nothing changed
    void reorderLayout(next).catch(() => {
      // On failure the refetch restores the server layout.
    });
  }

  function handleDragCancel(): void {
    dragInFlightRef.current = false;
    setActiveDragId(null);
    setDragOverRoomId(null);
    setLayoutState(syncedLayout);
  }

  async function addRoom(): Promise<void> {
    const room = await createRoom(t('rooms.defaultName'));
    setJustCreatedRoomId(room?.id ?? null);
  }

  // Buy control resolved once for the whole list (SearchRow stays presentational).
  const isDesktop = document.documentElement.dataset['shell'] === 'desktop';
  const isMac = window.systemInfo?.platform === 'darwin';
  const canControl = status?.capabilities.canControl ?? false;

  const needsLogin =
    status !== null && (!status.session.hasSession || status.session.probedValid === false);

  // "Getting started" checklist (#36) — derived from live state, shown until
  // the funnel completes or the operator dismisses it.
  const onboarding = useOnboardingState();
  const gettingStarted = deriveGettingStarted({
    hasValidSession: status !== null && !needsLogin,
    searchCount: searches.length,
    firstHitReceived: status?.onboarding.firstHitReceived ?? false,
  });
  const showGettingStarted =
    !needsLogin && loaded && !onboarding.checklistDismissed && !gettingStarted.allDone;

  const searchesById = new Map(searches.map((search) => [search.id, search]));
  // Row React keys use addedAt (stable across deal enable/disable + re-derive
  // id swaps + settings re-points), so an open panel never remounts shut;
  // duplicate timestamps (import artifacts) fall back to the volatile scheme.
  const duplicatedRowKeys = duplicatedAddedAts(searches);
  const roomsById = new Map(rooms.map((room) => [room.id, room]));
  // Archived searches (#35): greyed flat section at the bottom, newest first.
  const archivedSearches = searches
    .filter((search) => search.archivedAt !== null)
    .sort((first, second) => second.archivedAt!.localeCompare(first.archivedAt!));

  function renderDragGhost(dndId: string) {
    const draggedRoomId = roomIdFromDndId(dndId);
    if (draggedRoomId !== null) {
      const room = roomsById.get(draggedRoomId);
      if (!room) return null;
      const roomEntry = layoutState.find(
        (entry) => entry.kind === 'room' && entry.id === draggedRoomId,
      );
      const memberCount = roomEntry?.kind === 'room' ? roomEntry.searchIds.length : 0;
      return <RoomDragGhost name={room.name} memberCount={memberCount} />;
    }
    const search = searchesById.get(dndId);
    return search ? <SearchDragGhost label={search.label} /> : null;
  }

  // `extraPaused` grays a row's TRAVEL/BUY like a global pause does — the page
  // passes it for members of a room whose master switch is OFF, so an inactive
  // room's items read as paused, matching the global detection toggle (#15).
  const renderSearchRow = (search: SearchRuntimeInfo, extraPaused = false) => (
    <SearchRow
      key={stableRowKey(search, duplicatedRowKeys)}
      search={search}
      highlighted={isSearchLit(search.id)}
      detectionPaused={paused || extraPaused}
      buyControl={resolveBuyControl({
        isDesktop,
        isMac,
        canControl,
        autoBuy: search.autoBuy,
      })}
      onUpdate={(payload) => update(search.id, payload)}
      nowMs={nowMs}
      onRemove={() => remove(search.id)}
      onRestart={() => restartSearch(search.id)}
      onPanelOpenChange={reportPanelOpen}
      spotlitAt={
        spotlight !== null && spotlight.searchId === search.id && isSpotlightFresh(spotlight, nowMs)
          ? spotlight.at
          : null
      }
    />
  );

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-ink">{t('searches.title')}</h1>
        <span className="flex items-center gap-3">
          {!needsLogin && (
            <Button variant="ghost" onClick={() => void addRoom()}>
              <FolderPlus className="h-4 w-4" />
              {t('rooms.new')}
            </Button>
          )}
          <span className="flex items-center gap-2 text-xs text-ink-muted">
            {t('searches.detectionToggle')}
            <Switch
              checked={!paused}
              onChange={(detectionOn) => void setDetectionPaused(!detectionOn)}
              label={t('searches.detectionToggle')}
            />
          </span>
        </span>
      </div>
      {needsLogin ? (
        <LoginRequired />
      ) : (
        <>
          {showGettingStarted && (
            <GettingStartedCard
              progress={gettingStarted}
              onDismiss={() => setGettingStartedDismissed(true)}
            />
          )}
          <AddSearchForm onAdd={add} />
          {loaded && searches.length === 0 && rooms.length === 0 && (
            <p className="text-sm text-ink-faint">{t('searches.empty')}</p>
          )}
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            // Rooms grow/shrink WHILE a search drags across them (live preview),
            // so droppable rects must re-measure continuously, not just on start.
            measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <SortableContext
              items={layoutState.map((entry) =>
                entry.kind === 'room' ? roomDragId(entry.id) : entry.id,
              )}
              strategy={verticalListSortingStrategy}
            >
              <ul className="flex flex-col gap-2">
                {layoutState.map((entry) => {
                  if (entry.kind === 'search') {
                    const search = searchesById.get(entry.id);
                    return search ? renderSearchRow(search) : null;
                  }
                  const room = roomsById.get(entry.id);
                  if (!room) return null;
                  const members = entry.searchIds
                    .map((searchId) => searchesById.get(searchId))
                    .filter((search): search is SearchRuntimeInfo => search !== undefined);
                  const visuallyCollapsed = isRoomVisuallyCollapsed({
                    persistedCollapsed: room.collapsed,
                    hasFreshHit: freshRoomIds.has(room.id),
                    suppressed: suppressedRoomIds.has(room.id),
                  });
                  // Master switch OFF (no member enabled) → its items read as paused
                  // (grayed TRAVEL/BUY), mirroring the global detection pause (#15).
                  const roomInactive =
                    members.length > 0 && !members.some((member) => member.enabled);
                  // Force-expand while a search is dragged over/into this room so the
                  // operator can drop BETWEEN its members, not just append (#14). A
                  // collapsed room unmounts its members, so it must open first.
                  const dragExpanded =
                    activeDragSearchId !== null &&
                    (room.id === activeSearchRoomId || room.id === dragOverRoomId);
                  return (
                    <RoomSection
                      key={room.id}
                      room={room}
                      members={members}
                      collapsed={dragExpanded ? false : visuallyCollapsed}
                      // Keyed to the PERSISTED collapse: the header keeps glowing
                      // for the whole window even while auto-expanded (D-room-3).
                      highlighted={room.collapsed && freshRoomIds.has(room.id)}
                      startRenaming={justCreatedRoomId === room.id}
                      forceCollapsed={isRoomDragActive}
                      detectionPaused={paused}
                      renderSearch={(member) => renderSearchRow(member, roomInactive)}
                      onRename={(name) => {
                        if (justCreatedRoomId === room.id) setJustCreatedRoomId(null);
                        return updateRoom(room.id, { name });
                      }}
                      onSetEnabled={(enabled) => setRoomEnabled(room.id, enabled)}
                      onToggleCollapsed={() => {
                        if (!visuallyCollapsed) {
                          // Collapsing during a fresh window: suppress the
                          // auto-expand for the rest of the window, or the room
                          // would pop straight back open. Applies to BOTH an
                          // auto-expanded room (persisted already collapsed →
                          // local only, no server write) and a persisted-
                          // expanded one (also PATCH the preference).
                          if (freshRoomIds.has(room.id)) suppressRoom(room.id);
                          // Collapsing the spotlit room dismisses the spotlight
                          // (otherwise its suppression override would reopen it).
                          // Same layout source as the override — see spotlitRoomId.
                          if (spotlitRoomId === room.id) clearSearchSpotlight();
                          return room.collapsed
                            ? Promise.resolve()
                            : updateRoom(room.id, { collapsed: true });
                        }
                        return updateRoom(room.id, { collapsed: false });
                      }}
                      onDelete={(mode) => removeRoom(room.id, mode)}
                    />
                  );
                })}
              </ul>
            </SortableContext>
            {/* The dragged item renders as a floating ghost above everything —
                never clipped by room borders, and the source row just dims. */}
            <DragOverlay>{activeDragId !== null && renderDragGhost(activeDragId)}</DragOverlay>
          </DndContext>
          {archivedSearches.length > 0 && (
            <section className="mt-2 flex flex-col gap-2">
              <h2 className="text-xs font-semibold tracking-widest text-ink-faint uppercase">
                {t('searches.archivedSection')} ({archivedSearches.length})
              </h2>
              <ul className="flex flex-col gap-2">
                {archivedSearches.map((search) => (
                  <ArchivedSearchRow
                    key={stableRowKey(search, duplicatedRowKeys)}
                    search={search}
                    highlighted={isSearchLit(search.id)}
                    onRestore={() => update(search.id, { archived: false })}
                    onRemove={() => remove(search.id)}
                  />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </section>
  );
}
