import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Archive,
  ArchiveRestore,
  ExternalLink,
  Folder,
  FolderPlus,
  GripVertical,
  ListFilter,
  LogIn,
  Pencil,
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
  tradeSearchPageUrl,
  type EngineStatus,
  type SearchLayoutEntry,
  type SearchPreview,
  type SearchRuntimeInfo,
} from '@poe-sniper/shared';
import { Badge, type BadgeTone } from '../components/Badge';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Field } from '../components/Field';
import { IconButton } from '../components/IconButton';
import { Modal } from '../components/Modal';
import { QueryCriteriaView } from '../components/QueryCriteriaView';
import { RoomSection } from '../components/RoomSection';
import { Select } from '../components/Select';
import { Tooltip } from '../components/Tooltip';
import { Switch } from '../components/Switch';
import { TextInput } from '../components/TextInput';
import { useLeagues } from '../hooks/useLeagues';
import { useDetection } from '../hooks/useDetection';
import { useEventStream } from '../hooks/EventStreamProvider';
import { useSearches, type AddSearchPayload } from '../hooks/useSearches';
import { useServerStatus } from '../hooks/useServerStatus';
import { useT, useTn } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';
import { resolveBuyControl, type BuyControl } from '../lib/resolve-buy-control';
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
  degraded: 'danger',
  stopped: 'neutral',
  paused: 'info',
};

const STATUS_LABEL_KEYS: Record<EngineStatus, MessageKey> = {
  pending: 'engineStatus.pending',
  connecting: 'engineStatus.connecting',
  active: 'engineStatus.active',
  degraded: 'engineStatus.degraded',
  stopped: 'engineStatus.stopped',
  paused: 'engineStatus.paused',
};

/** Hover-popover explanations for each status badge. */
const STATUS_DESC_KEYS: Record<EngineStatus, MessageKey> = {
  pending: 'engineStatusDesc.pending',
  connecting: 'engineStatusDesc.connecting',
  active: 'engineStatusDesc.active',
  degraded: 'engineStatusDesc.degraded',
  stopped: 'engineStatusDesc.stopped',
  paused: 'engineStatusDesc.paused',
};

function AddSearchForm({ onAdd }: { onAdd: (payload: AddSearchPayload) => Promise<void> }) {
  const t = useT();
  const { leagues } = useLeagues();
  const [input, setInput] = useState('');
  const [label, setLabel] = useState('');
  const [league, setLeague] = useState('');
  const [autoTravel, setAutoTravel] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [previewQuery, setPreviewQuery] = useState<unknown>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // The URL is the source of truth for league + purchase type (D-14).
  // Only a bare id needs a league — the resolve endpoint takes it in the path.
  const trimmedInput = input.trim();
  const inputIsBareId = trimmedInput !== '' && !/^(https?|wss?):\/\//.test(trimmedInput);

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
      setErrorMessage(error instanceof ApiError ? error.message : t('common.requestFailed'));
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
      });
      setInput('');
      setLabel('');
      setAutoTravel(false);
      // After a successful add, collapse the form (and any open preview) so the
      // search list isn't pushed down by the editor — it reopens on click.
      setPreviewOpen(false);
      setPreviewQuery(null);
      setCollapsed(true);
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : t('common.requestFailed'));
    } finally {
      setSubmitting(false);
    }
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
      onSubmit={(formEvent) => void submit(formEvent)}
      onBlur={(blurEvent) => {
        // Focus left the form for another element IN the app → tuck the form
        // away (draft state survives — reopening shows it again). Alt-tabbing
        // out (e.g. to copy the trade URL) keeps it open: relatedTarget is null
        // then AND the document has lost focus, so we deliberately skip.
        const focusMovedTo = blurEvent.relatedTarget as Node | null;
        if (!blurEvent.currentTarget.contains(focusMovedTo) && document.hasFocus()) {
          setCollapsed(true);
        }
      }}
      className="rounded-lg border border-edge bg-surface-1 p-4"
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
        <Button variant="primary" type="submit" disabled={submitting || input.trim() === ''}>
          <Plus className="h-4 w-4" />
          {t('searches.watch')}
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
  onUpdate,
  onRemove,
}: {
  search: SearchRuntimeInfo;
  buyControl: BuyControl;
  highlighted: boolean;
  /** Global detection pause — TRAVEL/BUY are inert then, so they grey out
   *  (still togglable: configuring while paused is fine, nothing fires). */
  detectionPaused: boolean;
  onUpdate: (payload: {
    autoTravel?: boolean;
    autoBuy?: boolean;
    enabled?: boolean;
    label?: string;
    input?: string;
    archived?: boolean;
  }) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const t = useT();
  const tn = useTn();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [criteriaOpen, setCriteriaOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftLabel, setDraftLabel] = useState(search.label);
  const [draftInput, setDraftInput] = useState(search.id);
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: search.id,
  });

  function startEditing(): void {
    setDraftLabel(search.label);
    setDraftInput(search.id);
    setEditing(true);
  }

  async function saveEdit(): Promise<void> {
    const label = draftLabel.trim();
    const input = draftInput.trim();
    if (!label || !input) return;
    setEditing(false);
    // Nothing changed → skip the round-trip. A changed `input` re-points the row
    // (the server keeps the hit history); an unchanged id is treated as label-only.
    if (label === search.label && input === search.id) return;
    await run(() => onUpdate({ label, input }));
  }

  async function run(action: () => Promise<void>) {
    setErrorMessage(null);
    try {
      await action();
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : t('common.requestFailed'));
    }
  }

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
      <Modal open={editing} label={t('searches.editSearch')} onClose={() => setEditing(false)}>
        <div className="border-b border-edge px-4 py-2.5">
          <h2 className="text-sm font-semibold text-ink">{t('searches.editSearch')}</h2>
        </div>
        <div className="space-y-3 p-4">
          <Field label={t('searches.editLabelField')}>
            <TextInput
              value={draftLabel}
              onChange={(changeEvent) => setDraftLabel(changeEvent.target.value)}
            />
          </Field>
          <Field label={t('searches.editSearchField')} hint={t('searches.editSearchHint')}>
            <TextInput
              value={draftInput}
              onChange={(changeEvent) => setDraftInput(changeEvent.target.value)}
            />
          </Field>
        </div>
        <div className="flex justify-end gap-2 border-t border-edge px-4 py-2.5">
          <Button variant="ghost" onClick={() => setEditing(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!draftLabel.trim() || !draftInput.trim()}
            onClick={() => void saveEdit()}
          >
            {t('common.save')}
          </Button>
        </div>
      </Modal>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
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
            <IconButton
              variant="ghost"
              aria-label={t('searches.editSearch')}
              title={t('searches.editSearch')}
              onClick={startEditing}
            >
              <Pencil className="h-3 w-3" />
            </IconButton>
            <a
              href={tradeSearchPageUrl(search.realm, search.league, search.id)}
              target="_blank"
              rel="noreferrer"
              aria-label={t('searches.openOnTradeSite')}
              title={t('searches.openOnTradeSite')}
              className="shrink-0 text-ink-faint transition-colors hover:text-ink"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
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
          </div>
        </div>
        <div className="flex-1" />
        <IconButton
          variant="ghost"
          aria-label={criteriaOpen ? t('criteria.hide') : t('criteria.show')}
          title={criteriaOpen ? t('criteria.hide') : t('criteria.show')}
          aria-expanded={criteriaOpen}
          className={criteriaOpen ? 'text-gold' : undefined}
          onClick={() => setCriteriaOpen((previous) => !previous)}
        >
          <ListFilter className="h-4 w-4" />
        </IconButton>
        <span className="flex items-center gap-1.5 text-xs text-ink-muted">
          <Switch
            checked={search.enabled}
            onChange={(checked) => void run(() => onUpdate({ enabled: checked }))}
            label={t('searches.activeFor', { label: search.label })}
            tone={search.status === 'paused' ? 'info' : 'gold'}
          />
          {t('searches.activeToggle')}
        </span>
        <span
          className={`flex items-center gap-1.5 text-xs text-ink-muted transition-opacity ${
            detectionPaused ? 'opacity-40' : ''
          }`}
          title={detectionPaused ? t('engineStatusDesc.paused') : undefined}
        >
          <Switch
            checked={search.autoTravel}
            onChange={(checked) => void run(() => onUpdate({ autoTravel: checked }))}
            label={t('searches.autoFor', { label: search.label })}
          />
          {t('searches.travelToggle')}
        </span>
        <span
          className={`flex items-center gap-1.5 text-xs text-ink-muted transition-opacity ${
            detectionPaused ? 'opacity-40' : ''
          }`}
          title={detectionPaused ? t('engineStatusDesc.paused') : undefined}
        >
          <Switch
            checked={buyControl.checked}
            disabled={!buyControl.enabled}
            onChange={(checked) => void run(() => onUpdate({ autoBuy: checked }))}
            label={t('searches.buyFor', { label: search.label })}
            tone="gold"
          />
          {t('searches.buyToggle')}
          {buyControl.note &&
            (buyControl.note === 'searches.buyNeedsPermission' ? (
              <Link
                to="/settings"
                className="text-ink-faint underline underline-offset-2 hover:text-ink"
              >
                {t(buyControl.note)}
              </Link>
            ) : (
              <span className="text-ink-faint">{t(buyControl.note)}</span>
            ))}
        </span>
        <IconButton
          variant="ghost"
          aria-label={t('searches.archive', { label: search.label })}
          title={t('searches.archive', { label: search.label })}
          onClick={() => void run(() => onUpdate({ archived: true }))}
        >
          <Archive className="h-4 w-4" />
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
      {/* Only surface the status detail when something is off — on the happy path the
          ACTIVE + WS/POLL badges (with their hover popovers) already say it, so the
          raw "live websocket connected" line is redundant noise. Same for a global
          pause: the paused badge + greyed toggles already say it on EVERY row, so
          repeating "globally paused" per search is noise too. */}
      {search.statusDetail && search.status !== 'active' && search.status !== 'paused' && (
        <div className="mt-1.5 text-xs text-ink-faint">{search.statusDetail}</div>
      )}
      {errorMessage && <div className="mt-1.5 text-xs text-danger">{errorMessage}</div>}
      {criteriaOpen && (
        <div className="mt-2 border-t border-edge pt-3">
          <QueryCriteriaView query={search.filters} />
        </div>
      )}
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

  async function run(action: () => Promise<void>) {
    setErrorMessage(null);
    try {
      await action();
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : t('common.requestFailed'));
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
      <div className="flex flex-wrap items-center gap-3">
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
  useEffect(() => {
    const isOperatorMidInteraction = (): boolean => {
      if (dragInFlightRef.current) return true;
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
    totalHitCount: searches.reduce((total, search) => total + search.hitCount, 0),
  });
  const showGettingStarted =
    !needsLogin && loaded && !onboarding.checklistDismissed && !gettingStarted.allDone;

  const searchesById = new Map(searches.map((search) => [search.id, search]));
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

  const renderSearchRow = (search: SearchRuntimeInfo) => (
    <SearchRow
      key={search.id}
      search={search}
      highlighted={isSearchLit(search.id)}
      detectionPaused={paused}
      buyControl={resolveBuyControl({
        isDesktop,
        isMac,
        canControl,
        autoBuy: search.autoBuy,
      })}
      onUpdate={(payload) => update(search.id, payload)}
      onRemove={() => remove(search.id)}
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
                  return (
                    <RoomSection
                      key={room.id}
                      room={room}
                      members={members}
                      collapsed={visuallyCollapsed}
                      // Keyed to the PERSISTED collapse: the header keeps glowing
                      // for the whole window even while auto-expanded (D-room-3).
                      highlighted={room.collapsed && freshRoomIds.has(room.id)}
                      startRenaming={justCreatedRoomId === room.id}
                      forceCollapsed={isRoomDragActive}
                      detectionPaused={paused}
                      renderSearch={renderSearchRow}
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
                    key={search.id}
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
