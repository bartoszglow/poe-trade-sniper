import { useState } from 'react';
import { Lock } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { SearchRuntimeInfo } from '@poe-sniper/shared';
import { useT } from '../../i18n/i18n';
import { ApiError } from '../../lib/api';
import type { BuyControl } from '../../lib/resolve-buy-control';
import { draftsNeedReseed, type SettingsDraftAnchor } from '../../lib/settings-drafts';
import type { UpdateSearchPayload } from '../../hooks/useSearches';
import { Button } from '../Button';
import { Switch } from '../Switch';
import { TextInput } from '../TextInput';

interface SettingsCardProps {
  search: SearchRuntimeInfo;
  detectionPaused: boolean;
  buyControl: BuyControl;
  onUpdate: (payload: UpdateSearchPayload) => Promise<void>;
}

/**
 * The unified panel's search-settings section (plan 42, Q1) — the former edit
 * modal inlined: label + id/URL with Save on its own bottom-right row, plus the
 * AUTOMATION zone that used to crowd the row header (operator iteration
 * 2026-07-05): the TRAVEL/BUY opt-ins with one-line explanations. The toggles
 * apply INSTANTLY (they are not part of the Save form) — the hairline divider
 * separates the two behaviors.
 *
 * While deal mode is on the system owns the row's id (plan 41, D-dw-7): the id
 * input locks and Save sends label-only — a re-derive can swap `search.id`
 * mid-edit and the server 409s manual id changes for deal-mode rows anyway.
 * Drafts seed on mount (the panel lazy-mounts this card) and RE-seed on an
 * identity transition (adjust-during-render below): disabling deal mode in the
 * sibling card restores the original id, and a stale draft would silently
 * re-point the search to the dead auto id.
 */
export function SettingsCard({ search, detectionPaused, buyControl, onUpdate }: SettingsCardProps) {
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

  async function toggle(payload: UpdateSearchPayload): Promise<void> {
    setErrorMessage(null);
    try {
      await onUpdate(payload);
    } catch (error) {
      setErrorMessage(
        error instanceof ApiError && error.userFacing ? error.message : t('common.requestFailed'),
      );
    }
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
          reserved hint line; Save sits on its own bottom row, right-aligned. */}
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
      <div className="mt-1 flex justify-end">
        <Button variant="primary" disabled={!canSave} onClick={() => void save()}>
          {t('common.save')}
        </Button>
      </div>

      {/* AUTOMATION — instant per-search opt-ins (hard rule 5), moved here from
          the row header (operator iteration 2026-07-05). Not part of the Save
          form: each switch persists the moment it flips. */}
      <div className="mt-3 border-t border-edge pt-3">
        <h4 className="text-[11px] font-medium tracking-wide text-ink-muted uppercase">
          {t('searchPanel.automation')}
        </h4>
        <div
          className={`mt-2 flex flex-col gap-2.5 transition-opacity ${
            detectionPaused ? 'opacity-40' : ''
          }`}
          title={detectionPaused ? t('engineStatusDesc.paused') : undefined}
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="flex items-center gap-1.5 text-xs text-ink-muted">
              <Switch
                checked={search.autoTravel}
                onChange={(checked) => void toggle({ autoTravel: checked })}
                label={t('searches.autoFor', { label: search.label })}
              />
              {t('searches.travelToggle')}
            </span>
            <span className="text-[11px] text-ink-faint">{t('searches.travelDesc')}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="flex items-center gap-1.5 text-xs text-ink-muted">
              <Switch
                checked={buyControl.checked}
                disabled={!buyControl.enabled}
                onChange={(checked) => void toggle({ autoBuy: checked })}
                label={t('searches.buyFor', { label: search.label })}
                tone="gold"
              />
              {t('searches.buyToggle')}
            </span>
            <span className="text-[11px] text-ink-faint">{t('searches.buyDesc')}</span>
            {buyControl.note &&
              (buyControl.note === 'searches.buyNeedsPermission' ? (
                <Link
                  to="/settings"
                  className="text-[11px] text-ink-faint underline underline-offset-2 hover:text-ink"
                >
                  {t(buyControl.note)}
                </Link>
              ) : (
                <span className="text-[11px] text-ink-faint">{t(buyControl.note)}</span>
              ))}
          </div>
        </div>
      </div>

      {errorMessage !== null && <p className="mt-2 text-xs text-danger">{errorMessage}</p>}
    </section>
  );
}
