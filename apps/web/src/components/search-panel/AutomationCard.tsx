import { Link } from 'react-router-dom';
import type { SearchRuntimeInfo } from '@poe-sniper/shared';
import { useState } from 'react';
import { useT } from '../../i18n/i18n';
import { ApiError } from '../../lib/api';
import type { BuyControl } from '../../lib/resolve-buy-control';
import type { UpdateSearchPayload } from '../../hooks/useSearches';
import { Switch } from '../Switch';

interface AutomationCardProps {
  search: SearchRuntimeInfo;
  detectionPaused: boolean;
  buyControl: BuyControl;
  onUpdate: (payload: UpdateSearchPayload) => Promise<void>;
}

/**
 * Per-search automation opt-ins (hard rule 5), a standalone card in the panel's
 * left column above the item criteria (operator iteration 2026-07-05, moved out
 * of the row header and then out of the settings card). Each switch persists the
 * instant it flips — this is not a Save-gated form. TRAVEL = auto-teleport on a
 * hit; BUY = cursor automation after a successful travel (permission-gated via
 * resolveBuyControl, resolved at page level).
 */
export function AutomationCard({
  search,
  detectionPaused,
  buyControl,
  onUpdate,
}: AutomationCardProps) {
  const t = useT();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  return (
    <section className="rounded-md border border-edge bg-surface-2 p-3">
      <h3 className="text-xs font-medium tracking-wide text-ink-muted uppercase">
        {t('searchPanel.automation')}
      </h3>
      <div
        className={`mt-2.5 flex flex-col gap-2.5 transition-opacity ${
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
      {errorMessage !== null && <p className="mt-2 text-xs text-danger">{errorMessage}</p>}
    </section>
  );
}
