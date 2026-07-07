import {
  BASELINE_SAMPLE_SIZE_MAX,
  BASELINE_SAMPLE_SIZE_MIN,
  DEAL_REFRESH_INTERVAL_OPTIONS_MS,
} from '@poe-sniper/shared';
import type { DealWatchMode, DealWatchUnit } from '@poe-sniper/shared';
import { useT } from '../../i18n/i18n';
import type { MessageKey } from '../../i18n/messages';
import { Field } from '../Field';
import { NumberInput } from '../NumberInput';
import { Select } from '../Select';

/** ms → i18n key for the refresh-interval options (D-dw-20). */
const REFRESH_INTERVAL_LABEL_KEYS: Record<number, MessageKey> = {
  1_800_000: 'dealWatch.refreshEvery.30m',
  3_600_000: 'dealWatch.refreshEvery.1h',
  10_800_000: 'dealWatch.refreshEvery.3h',
  21_600_000: 'dealWatch.refreshEvery.6h',
  43_200_000: 'dealWatch.refreshEvery.12h',
};

export interface DealConfigFieldsProps {
  mode: DealWatchMode;
  onModeChange: (mode: DealWatchMode) => void;
  threshold: string;
  onThresholdChange: (raw: string) => void;
  unit: DealWatchUnit;
  onUnitChange: (unit: DealWatchUnit) => void;
  sampleSize: string;
  onSampleSizeChange: (raw: string) => void;
  sampleSizeValid: boolean;
  /** null = the global default cadence (D-dw-20). */
  refreshIntervalMs: number | null;
  onRefreshIntervalChange: (value: number | null) => void;
}

/**
 * The deal-config field group (D-dw-16): the 70/30 mode+threshold row with the
 * %/unit rendered as an integrated suffix, plus the D-dw-15 sample-size knob.
 * Shared verbatim between the DealPriceCard (enable/manage) and the add-search
 * form so the two surfaces can never drift. Purely presentational — parents own
 * the draft state, parsing and validation.
 */
export function DealConfigFields({
  mode,
  onModeChange,
  threshold,
  onThresholdChange,
  unit,
  onUnitChange,
  sampleSize,
  onSampleSizeChange,
  sampleSizeValid,
  refreshIntervalMs,
  onRefreshIntervalChange,
}: DealConfigFieldsProps) {
  const t = useT();
  return (
    <>
      {/* minmax(0,…) so an fr track can shrink below its content min instead of
          overflowing the card — the number input then absorbs the shrink and the
          unit suffix stays visible (operator feedback 2026-07-06). */}
      <div className="grid grid-cols-[minmax(0,7fr)_minmax(0,3fr)] gap-2">
        <Field label={t('dealWatch.modeLabel')}>
          <Select
            value={mode}
            onChange={(value) => onModeChange(value === 'absolute' ? 'absolute' : 'percent')}
            options={[
              { value: 'percent', label: t('dealWatch.mode.percent') },
              { value: 'absolute', label: t('dealWatch.mode.absolute') },
            ]}
          />
        </Field>
        <Field label={t('dealWatch.thresholdLabel')}>
          <div className="flex min-w-0 items-stretch rounded-md border border-edge bg-surface-2 focus-within:border-gold">
            {/* Bare + no steppers: the wrapper owns the box and the suffix sits
                where the stepper would; native spinners are still hidden. */}
            <NumberInput
              variant="bare"
              steppers={false}
              min={0}
              step="any"
              value={threshold}
              onValueChange={onThresholdChange}
              ariaLabel={t('dealWatch.thresholdLabel')}
            />
            {mode === 'percent' ? (
              <span className="flex shrink-0 items-center border-l border-edge px-2 text-sm text-ink-muted">
                %
              </span>
            ) : (
              <Select
                variant="bare"
                className="shrink-0 border-l border-edge"
                value={unit}
                onChange={(value) => onUnitChange(value === 'divine' ? 'divine' : 'exalted')}
                ariaLabel={t('dealWatch.unitLabel')}
                options={[
                  { value: 'exalted', label: t('dealWatch.unit.exalted') },
                  { value: 'divine', label: t('dealWatch.unit.divine') },
                ]}
              />
            )}
          </div>
        </Field>
      </div>
      {/* Sample-size knob (D-dw-15): how many cheapest listings the base price
          is the median of — thin markets want ~5, liquid ones 10-20. */}
      <div className="flex items-center gap-2 text-xs text-ink-muted">
        <span>{t('dealWatch.sampleSizePrefix')}</span>
        <NumberInput
          className="w-20"
          min={BASELINE_SAMPLE_SIZE_MIN}
          max={BASELINE_SAMPLE_SIZE_MAX}
          step={1}
          value={sampleSize}
          onValueChange={onSampleSizeChange}
          invalid={!sampleSizeValid}
          ariaLabel={t('dealWatch.sampleSizeAria')}
        />
        <span>{t('dealWatch.sampleSizeSuffix')}</span>
      </div>
      {/* Per-watch refresh cadence (D-dw-20): how often the market price is
          re-checked (feeds the threshold cutoff). Default = the global. */}
      <Field label={t('dealWatch.refreshEveryLabel')}>
        <Select
          value={refreshIntervalMs === null ? '' : String(refreshIntervalMs)}
          onChange={(value) => onRefreshIntervalChange(value === '' ? null : Number(value))}
          ariaLabel={t('dealWatch.refreshEveryLabel')}
          options={[
            { value: '', label: t('dealWatch.refreshEvery.default') },
            ...DEAL_REFRESH_INTERVAL_OPTIONS_MS.map((ms) => ({
              value: String(ms),
              label: t(REFRESH_INTERVAL_LABEL_KEYS[ms] ?? 'dealWatch.refreshEvery.default'),
            })),
          ]}
        />
      </Field>
    </>
  );
}
