import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ExternalLink,
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
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  tradeSearchPageUrl,
  type EngineStatus,
  type SearchPreview,
  type SearchRuntimeInfo,
} from '@poe-sniper/shared';
import { Badge, type BadgeTone } from '../components/Badge';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { IconButton } from '../components/IconButton';
import { Modal } from '../components/Modal';
import { QueryCriteriaView } from '../components/QueryCriteriaView';
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

/** A search row glows for ~this long after one of its hits lands in the live feed. */
const HIGHLIGHT_MS = 60_000;
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
  onUpdate,
  onRemove,
}: {
  search: SearchRuntimeInfo;
  buyControl: BuyControl;
  highlighted: boolean;
  onUpdate: (payload: {
    autoTravel?: boolean;
    autoBuy?: boolean;
    enabled?: boolean;
    label?: string;
    input?: string;
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
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-lg border px-4 py-3 transition-colors ${
        isDragging
          ? 'z-10 border-gold/70 opacity-80'
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
        <span className="flex items-center gap-1.5 text-xs text-ink-muted">
          <Switch
            checked={search.autoTravel}
            onChange={(checked) => void run(() => onUpdate({ autoTravel: checked }))}
            label={t('searches.autoFor', { label: search.label })}
          />
          {t('searches.travelToggle')}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-ink-muted">
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
        {confirmingDelete ? (
          <Button variant="danger" onClick={() => void run(onRemove)}>
            {t('common.confirm')}
          </Button>
        ) : (
          <IconButton
            variant="danger"
            aria-label={t('searches.remove', { label: search.label })}
            onClick={() => {
              setConfirmingDelete(true);
              setTimeout(() => setConfirmingDelete(false), 3000);
            }}
          >
            <Trash2 className="h-4 w-4" />
          </IconButton>
        )}
      </div>
      {/* Only surface the status detail when something is off — on the happy path the
          ACTIVE + WS/POLL badges (with their hover popovers) already say it, so the
          raw "live websocket connected" line is redundant noise. */}
      {search.statusDetail && search.status !== 'active' && (
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

export function SearchesPage() {
  const t = useT();
  const { status } = useServerStatus();
  const { searches, loaded, add, update, remove, reorder } = useSearches();
  const { paused, setDetectionPaused } = useDetection();
  const { lastHitAtBySearchId } = useEventStream();

  // Local copy so a drag reorders instantly (optimistic); it re-syncs from the server on
  // every searches change (add/remove/reorder refetch) — done DURING render (React's
  // adjust-state-on-prop-change pattern), not in an effect. The server order IS the
  // user's order now, so there's no client-side re-sort.
  const [items, setItems] = useState<SearchRuntimeInfo[]>(searches);
  const [syncedSearches, setSyncedSearches] = useState(searches);
  if (searches !== syncedSearches) {
    setSyncedSearches(searches);
    setItems(searches);
  }

  // Re-render periodically so the ~60s "just found" row highlight ages out.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), HIGHLIGHT_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  const isHighlighted = (searchId: string): boolean => {
    const at = lastHitAtBySearchId[searchId];
    return at !== undefined && nowMs - new Date(at).getTime() < HIGHLIGHT_MS;
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent): void {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((entry) => entry.id === active.id);
    const newIndex = items.findIndex((entry) => entry.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(items, oldIndex, newIndex);
    setItems(next); // optimistic — the searches refetch reconciles
    void reorder(next.map((entry) => entry.id)).catch(() => {
      // On failure the refetch restores the server order.
    });
  }

  // Buy control resolved once for the whole list (SearchRow stays presentational).
  const isDesktop = document.documentElement.dataset['shell'] === 'desktop';
  const isMac = window.systemInfo?.platform === 'darwin';
  const canControl = status?.capabilities.canControl ?? false;

  const needsLogin =
    status !== null && (!status.session.hasSession || status.session.probedValid === false);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-ink">{t('searches.title')}</h1>
        <span className="flex items-center gap-2 text-xs text-ink-muted">
          {t('searches.detectionToggle')}
          <Switch
            checked={!paused}
            onChange={(detectionOn) => void setDetectionPaused(!detectionOn)}
            label={t('searches.detectionToggle')}
          />
        </span>
      </div>
      {needsLogin ? (
        <LoginRequired />
      ) : (
        <>
          <AddSearchForm onAdd={add} />
          {loaded && searches.length === 0 && (
            <p className="text-sm text-ink-faint">{t('searches.empty')}</p>
          )}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={items.map((entry) => entry.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="flex flex-col gap-2">
                {items.map((search) => (
                  <SearchRow
                    key={search.id}
                    search={search}
                    highlighted={isHighlighted(search.id)}
                    buyControl={resolveBuyControl({
                      isDesktop,
                      isMac,
                      canControl,
                      autoBuy: search.autoBuy,
                    })}
                    onUpdate={(payload) => update(search.id, payload)}
                    onRemove={() => remove(search.id)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        </>
      )}
    </section>
  );
}
