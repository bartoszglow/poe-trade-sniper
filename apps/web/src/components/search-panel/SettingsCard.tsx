import { useState } from 'react';
import { Lock } from 'lucide-react';
import type { SearchRuntimeInfo } from '@poe-sniper/shared';
import { useT } from '../../i18n/i18n';
import { ApiError } from '../../lib/api';
import { draftsNeedReseed, type SettingsDraftAnchor } from '../../lib/settings-drafts';
import type { UpdateSearchPayload } from '../../hooks/useSearches';
import { Button } from '../Button';
import { ConfirmDialog } from '../ConfirmDialog';
import { TextInput } from '../TextInput';

interface SettingsCardProps {
  search: SearchRuntimeInfo;
  onUpdate: (payload: UpdateSearchPayload) => Promise<void>;
  onRemove: () => Promise<void>;
}

/**
 * The unified panel's search-settings section (plan 42, Q1) — the former edit
 * modal inlined: label + id/URL, with the row's lifecycle actions on the bottom
 * bar (operator iteration 2026-07-05: Archive + Delete moved off the row header
 * to the left, Save right, dirty-gated). Delete keeps its ConfirmDialog.
 *
 * While deal mode is on the system owns the row's id (plan 41, D-dw-7): the id
 * input locks and Save sends label-only — a re-derive can swap `search.id`
 * mid-edit and the server 409s manual id changes for deal-mode rows anyway.
 * Drafts seed on mount (the panel lazy-mounts this card) and RE-seed on an
 * identity transition (adjust-during-render below): disabling deal mode in the
 * sibling card restores the original id, and a stale draft would silently
 * re-point the search to the dead auto id.
 */
export function SettingsCard({ search, onUpdate, onRemove }: SettingsCardProps) {
  const t = useT();
  const dealManaged = search.dealWatch !== null;
  const [draftLabel, setDraftLabel] = useState(search.label);
  const [draftInput, setDraftInput] = useState(search.id);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<SettingsDraftAnchor>({ id: search.id, dealManaged });
  if (draftsNeedReseed(anchor, { id: search.id, dealManaged })) {
    setAnchor({ id: search.id, dealManaged });
    setDraftLabel(search.label);
    setDraftInput(search.id);
  }

  async function run(action: () => Promise<void>): Promise<void> {
    setErrorMessage(null);
    try {
      await action();
    } catch (error) {
      setErrorMessage(
        error instanceof ApiError && error.userFacing ? error.message : t('common.requestFailed'),
      );
    }
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
    await run(() => onUpdate(payload));
    setSaving(false);
  }

  const labelDirty = draftLabel.trim() !== '' && draftLabel.trim() !== search.label;
  const idDirty = !dealManaged && draftInput.trim() !== '' && draftInput.trim() !== search.id;
  const canSave = !saving && (labelDirty || idDirty);

  return (
    <section className="rounded-md border border-edge bg-surface-2 p-3">
      <h3 className="text-xs font-medium tracking-wide text-ink-muted uppercase">
        {t('searchPanel.settings')}
      </h3>
      {/* Two equal fields side-by-side (stacked when narrow), each with a
          reserved hint line. */}
      <div className="mt-3 grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] tracking-wide text-ink-muted">
            {t('searches.editLabelField')}
          </span>
          <TextInput
            value={draftLabel}
            onChange={(changeEvent) => setDraftLabel(changeEvent.target.value)}
            className="w-full"
          />
          <span className="min-h-[1rem] text-[11px] text-ink-faint">
            {t('searches.editLabelHint')}
          </span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="flex items-center gap-1 text-[11px] tracking-wide text-ink-muted">
            {t('searches.editSearchField')}
            {dealManaged && <Lock className="h-3 w-3 text-ink-faint" aria-hidden />}
          </span>
          <TextInput
            value={dealManaged ? search.id : draftInput}
            disabled={dealManaged}
            onChange={(changeEvent) => setDraftInput(changeEvent.target.value)}
            className={`w-full font-mono ${dealManaged ? 'text-ink-faint' : ''}`}
          />
          <span className="min-h-[1rem] text-[11px] text-ink-faint">
            {t(dealManaged ? 'dealWatch.editIdLocked' : 'searches.editSearchHint')}
          </span>
        </label>
      </div>
      {/* Lifecycle bar: destructive actions left, Save right (operator
          iteration 2026-07-05 — off the row header, into the panel). */}
      <div className="mt-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => void run(() => onUpdate({ archived: true }))}>
            {t('searches.archiveAction')}
          </Button>
          <Button
            variant="ghost"
            className="text-danger hover:border-danger/60 hover:text-danger"
            onClick={() => setConfirmingDelete(true)}
          >
            {t('common.delete')}
          </Button>
        </div>
        <Button variant="primary" disabled={!canSave} onClick={() => void save()}>
          {t('common.save')}
        </Button>
      </div>

      {errorMessage !== null && <p className="mt-2 text-xs text-danger">{errorMessage}</p>}

      <ConfirmDialog
        open={confirmingDelete}
        title={t('searches.deleteConfirmTitle')}
        body={t('searches.deleteConfirmBody', { label: search.label })}
        onClose={() => setConfirmingDelete(false)}
        actions={[{ id: 'delete', label: t('common.delete'), onSelect: () => void run(onRemove) }]}
      />
    </section>
  );
}
