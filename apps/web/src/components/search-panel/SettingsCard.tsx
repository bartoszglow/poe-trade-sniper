import { useState } from 'react';
import type { SearchRuntimeInfo } from '@poe-sniper/shared';
import { useT } from '../../i18n/i18n';
import { ApiError } from '../../lib/api';
import { draftsNeedReseed, type SettingsDraftAnchor } from '../../lib/settings-drafts';
import type { UpdateSearchPayload } from '../../hooks/useSearches';
import { Button } from '../Button';
import { Field } from '../Field';
import { TextInput } from '../TextInput';

interface SettingsCardProps {
  search: SearchRuntimeInfo;
  onUpdate: (payload: UpdateSearchPayload) => Promise<void>;
}

/**
 * The unified panel's search-settings section (plan 42, Q1) — the former edit
 * modal inlined: label + id/URL with Save. While deal mode is on the system
 * owns the row's id (plan 41, D-dw-7): the id input locks and Save sends
 * label-only — a re-derive can swap `search.id` mid-edit and the server 409s
 * manual id changes for deal-mode rows anyway. Drafts seed on mount (the panel
 * lazy-mounts this card), so SSE refetches never clobber mid-edit typing —
 * but they RE-seed on an identity transition (adjust-during-render below):
 * disabling deal mode in the sibling card restores the original id, and a
 * stale draft would silently re-point the search to the dead auto id.
 */
export function SettingsCard({ search, onUpdate }: SettingsCardProps) {
  const t = useT();
  const dealManaged = search.dealWatch !== null;
  const [draftLabel, setDraftLabel] = useState(search.label);
  const [draftInput, setDraftInput] = useState(search.id);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<SettingsDraftAnchor>({ id: search.id, dealManaged });
  if (draftsNeedReseed(anchor, { id: search.id, dealManaged })) {
    setAnchor({ id: search.id, dealManaged });
    setDraftLabel(search.label);
    setDraftInput(search.id);
  }

  async function save(): Promise<void> {
    const label = draftLabel.trim();
    const input = draftInput.trim();
    if (!label || (!dealManaged && !input)) return;
    // Nothing changed → skip the round-trip. A changed `input` re-points the
    // row (the server keeps the hit history); an unchanged id is label-only.
    if (dealManaged || input === search.id) {
      if (label === search.label) return;
    }
    const payload: UpdateSearchPayload =
      dealManaged || input === search.id ? { label } : { label, input };
    setSaving(true);
    setErrorMessage(null);
    try {
      await onUpdate(payload);
    } catch (error) {
      setErrorMessage(
        error instanceof ApiError && error.userFacing ? error.message : t('common.requestFailed'),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-md border border-edge bg-surface-2 p-3">
      <h3 className="text-xs font-medium tracking-wide text-ink-muted uppercase">
        {t('searchPanel.settings')}
      </h3>
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <Field label={t('searches.editLabelField')}>
          <TextInput
            value={draftLabel}
            onChange={(changeEvent) => setDraftLabel(changeEvent.target.value)}
            className="w-56"
          />
        </Field>
        <Field
          label={t('searches.editSearchField')}
          hint={t(dealManaged ? 'dealWatch.editIdLocked' : 'searches.editSearchHint')}
        >
          <TextInput
            value={dealManaged ? search.id : draftInput}
            disabled={dealManaged}
            onChange={(changeEvent) => setDraftInput(changeEvent.target.value)}
            className="w-56"
          />
        </Field>
        <Button
          variant="primary"
          disabled={saving || !draftLabel.trim() || (!dealManaged && !draftInput.trim())}
          onClick={() => void save()}
        >
          {t('common.save')}
        </Button>
      </div>
      {errorMessage !== null && <p className="mt-1.5 text-xs text-danger">{errorMessage}</p>}
    </section>
  );
}
