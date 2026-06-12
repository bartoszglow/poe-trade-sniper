import { useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { EngineStatus, SearchRuntimeInfo } from '@poe-sniper/shared';
import { Badge, type BadgeTone } from '../components/Badge';
import { Button } from '../components/Button';
import { Field } from '../components/Field';
import { IconButton } from '../components/IconButton';
import { Select } from '../components/Select';
import { Switch } from '../components/Switch';
import { TextInput } from '../components/TextInput';
import { useLeagues } from '../hooks/useLeagues';
import { useSearches } from '../hooks/useSearches';
import { useT, useTn } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';
import { ApiError } from '../lib/api';

const STATUS_TONES: Record<EngineStatus, BadgeTone> = {
  pending: 'neutral',
  connecting: 'info',
  active: 'ok',
  degraded: 'danger',
  stopped: 'neutral',
};

const STATUS_LABEL_KEYS: Record<EngineStatus, MessageKey> = {
  pending: 'engineStatus.pending',
  connecting: 'engineStatus.connecting',
  active: 'engineStatus.active',
  degraded: 'engineStatus.degraded',
  stopped: 'engineStatus.stopped',
};

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

  // The URL is the source of truth for league + purchase type (D-14).
  // Only a bare id needs a league — the resolve endpoint takes it in the path.
  const trimmedInput = input.trim();
  const inputIsBareId = trimmedInput !== '' && !/^(https?|wss?):\/\//.test(trimmedInput);

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
    } catch (error) {
      setErrorMessage(error instanceof ApiError ? error.message : t('common.requestFailed'));
    } finally {
      setSubmitting(false);
    }
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
            onChange={(changeEvent) => setInput(changeEvent.target.value)}
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
  onUpdate,
  onRemove,
}: {
  search: SearchRuntimeInfo;
  onUpdate: (payload: { autoTravel?: boolean; enabled?: boolean }) => Promise<void>;
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
    <li className="rounded-lg border border-edge bg-surface-1 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-ink">{search.label}</span>
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
        <span className="flex items-center gap-1.5 text-xs text-ink-muted">
          <Switch
            checked={search.enabled}
            onChange={(checked) => void run(() => onUpdate({ enabled: checked }))}
            label={t('searches.activeFor', { label: search.label })}
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
    </li>
  );
}

export function SearchesPage() {
  const t = useT();
  const { searches, loaded, add, update, remove } = useSearches();

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-ink">{t('searches.title')}</h1>
      <AddSearchForm onAdd={add} />
      {loaded && searches.length === 0 && (
        <p className="text-sm text-ink-faint">{t('searches.empty')}</p>
      )}
      <ul className="flex flex-col gap-2">
        {searches.map((search) => (
          <SearchRow
            key={search.id}
            search={search}
            onUpdate={(payload) => update(search.id, payload)}
            onRemove={() => remove(search.id)}
          />
        ))}
      </ul>
    </section>
  );
}
