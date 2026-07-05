import { BASELINE_SAMPLE_SIZE_MAX, BASELINE_SAMPLE_SIZE_MIN } from '@poe-sniper/shared';
import type { DealWatchMode, DealWatchUnit } from '@poe-sniper/shared';
import { useT } from '../../i18n/i18n';
import { Field } from '../Field';
import { NumberInput } from '../NumberInput';
import { Select } from '../Select';

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
}: DealConfigFieldsProps) {
  const t = useT();
  return (
    <>
      <div className="grid grid-cols-[7fr_3fr] gap-2">
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
          <div className="flex items-stretch rounded-md border border-edge bg-surface-2 focus-within:border-gold">
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
              <span className="flex items-center border-l border-edge px-2 text-sm text-ink-muted">
                %
              </span>
            ) : (
              <Select
                variant="bare"
                className="border-l border-edge"
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
    </>
  );
}
