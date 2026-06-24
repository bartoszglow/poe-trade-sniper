import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check,
  ListFilter,
  LogIn,
  Pencil,
  Plus,
  Settings as SettingsIcon,
  Trash2,
  X,
} from 'lucide-react';
import type { EngineStatus, SearchPreview, SearchRuntimeInfo } from '@poe-sniper/shared';
import { Badge, type BadgeTone } from '../components/Badge';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { IconButton } from '../components/IconButton';
import { QueryCriteriaView } from '../components/QueryCriteriaView';
import { Select } from '../components/Select';
import { Switch } from '../components/Switch';
import { TextInput } from '../components/TextInput';
import { useLeagues } from '../hooks/useLeagues';
import { useDetection } from '../hooks/useDetection';
import { useFlipList } from '../hooks/useFlipList';
import { useSearches } from '../hooks/useSearches';
import { useServerStatus } from '../hooks/useServerStatus';
import { useT, useTn } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';
import { ApiError, apiSend } from '../lib/api';

/**
 * Display order: inactive searches sink to the bottom; within each group
 * auto-travel searches rise to the top. Stable — ties keep insertion order.
 */
function searchSortRank(search: SearchRuntimeInfo): number {
  return (search.enabled ? 0 : 2) + (search.autoTravel ? 0 : 1);
}

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

/** Resolved presentational state of a row's Buy toggle (SearchRow stays dumb). */
interface BuyControl {
  /** Toggle interactive (macOS desktop + Travel on + control granted). */
  enabled: boolean;
  /** Reflects autoBuy && canControl — a revoked permission shows off + disabled. */
  checked: boolean;
  /** Inline reason the toggle is disabled, or null when live. */
  note: MessageKey | null;
}

/**
 * Ordered resolver (first match wins) — composition over nested ternaries.
 * Decision #2=B: Buy needs macOS desktop + the control permission. It is
 * INDEPENDENT of the Travel toggle (D-19) — it triggers on any travel success
 * (auto or manual), so it needs no Travel opt-in here.
 */
function resolveBuyControl(args: {
  isDesktop: boolean;
  isMac: boolean;
  canControl: boolean;
  autoBuy: boolean;
}): BuyControl {
  if (!args.isDesktop) return { enabled: false, checked: false, note: 'searches.buyWebOnly' };
  if (!args.isMac) return { enabled: false, checked: false, note: 'searches.buyUnsupportedOs' };
  if (!args.canControl) {
    return { enabled: false, checked: false, note: 'searches.buyNeedsPermission' };
  }
  return { enabled: true, checked: args.autoBuy, note: null };
}

function AddSearchForm({
  onAdd,
}: {
  onAdd: (payload: {
    input: string;
    label?: string;
    league?: string;
    autoTravel: boolean;
  }) => Promise<void>;
}) {
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
  onUpdate,
  onRemove,
}: {
  search: SearchRuntimeInfo;
  buyControl: BuyControl;
  onUpdate: (payload: {
    autoTravel?: boolean;
    autoBuy?: boolean;
    enabled?: boolean;
    label?: string;
  }) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const t = useT();
  const tn = useTn();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [criteriaOpen, setCriteriaOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState(false);
  const [draftLabel, setDraftLabel] = useState(search.label);

  function startEditingLabel(): void {
    setDraftLabel(search.label);
    setEditingLabel(true);
  }

  async function saveLabel(): Promise<void> {
    const nextLabel = draftLabel.trim();
    setEditingLabel(false);
    if (nextLabel && nextLabel !== search.label) {
      await run(() => onUpdate({ label: nextLabel }));
    }
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
    <li data-flip-id={search.id} className="rounded-lg border border-edge bg-surface-1 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {editingLabel ? (
              <span className="flex items-center gap-1">
                <input
                  value={draftLabel}
                  onChange={(changeEvent) => setDraftLabel(changeEvent.target.value)}
                  onKeyDown={(keyEvent) => {
                    if (keyEvent.key === 'Enter') {
                      keyEvent.preventDefault();
                      void saveLabel();
                    } else if (keyEvent.key === 'Escape') {
                      setEditingLabel(false);
                    }
                  }}
                  autoFocus
                  className="w-44 rounded border border-edge bg-surface-0 px-2 py-0.5 text-sm text-ink focus:border-gold focus:outline-none"
                />
                <IconButton
                  variant="ghost"
                  aria-label={t('searches.saveLabel')}
                  title={t('searches.saveLabel')}
                  onClick={() => void saveLabel()}
                >
                  <Check className="h-3.5 w-3.5" />
                </IconButton>
                <IconButton
                  variant="ghost"
                  aria-label={t('common.cancel')}
                  title={t('common.cancel')}
                  onClick={() => setEditingLabel(false)}
                >
                  <X className="h-3.5 w-3.5" />
                </IconButton>
              </span>
            ) : (
              <>
                <span className="truncate font-medium text-ink">{search.label}</span>
                <IconButton
                  variant="ghost"
                  aria-label={t('searches.editLabel')}
                  title={t('searches.editLabel')}
                  onClick={startEditingLabel}
                >
                  <Pencil className="h-3 w-3" />
                </IconButton>
              </>
            )}
            <Badge tone={STATUS_TONES[search.status]}>{t(STATUS_LABEL_KEYS[search.status])}</Badge>
            {search.engine && (
              <Badge tone={search.engine === 'ws' ? 'gold' : 'neutral'}>{search.engine}</Badge>
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
          {buyControl.note && <span className="text-ink-faint">{t(buyControl.note)}</span>}
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
      {search.statusDetail && (
        <div className="mt-1.5 text-xs text-ink-faint">{search.statusDetail}</div>
      )}
      {errorMessage && <div className="mt-1.5 text-xs text-danger">{errorMessage}</div>}
      {criteriaOpen && (
        <div className="mt-2 border-t border-edge pt-2">
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
  const { searches, loaded, add, update, remove } = useSearches();
  const { paused, setDetectionPaused } = useDetection();
  // FLIP animation: rows glide to their new slot on a re-sort instead of jumping.
  const listParent = useFlipList<HTMLUListElement>();
  const orderedSearches = [...searches].sort((left, right) => {
    const byRank = searchSortRank(left) - searchSortRank(right);
    if (byRank !== 0) return byRank;
    // Same group → newest first (addedAt is ISO-8601, so lexicographic = chrono).
    return right.addedAt.localeCompare(left.addedAt);
  });

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
          <ul ref={listParent} className="flex flex-col gap-2">
            {orderedSearches.map((search) => (
              <SearchRow
                key={search.id}
                search={search}
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
        </>
      )}
    </section>
  );
}
