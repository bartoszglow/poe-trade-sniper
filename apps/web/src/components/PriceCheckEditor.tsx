import type {
  PriceCheckAttrFilter,
  PriceCheckDraft,
  PriceCheckFilter,
  PriceCheckStatFilter,
} from '@poe-sniper/shared';
import { useT } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';
import { Button } from './Button';
import { NumberInput } from './NumberInput';

/** Attribute discriminator → i18n key. Falls back to the server label for a
 *  future registry attr without a key (keeps EN+PL parity for the known ones). */
const ATTR_LABEL_KEYS: Record<string, MessageKey> = {
  itemLevel: 'priceCheck.attr.itemLevel',
  quality: 'priceCheck.attr.quality',
  corrupted: 'priceCheck.attr.corrupted',
  baseType: 'priceCheck.attr.baseType',
};

interface PriceCheckEditorProps {
  draft: PriceCheckDraft;
  onChange: (draft: PriceCheckDraft) => void;
  onPrice: () => void;
  pricing: boolean;
}

/** Fill a `#`-templated stat with its rolled values for a readable label. */
function fillTemplate(text: string, rolls: number[]): string {
  let index = 0;
  return text.replace(/#/g, () => (index < rolls.length ? String(rolls[index++]) : '#'));
}

function parseNumber(raw: string): number | null {
  if (raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * The interactive price-check editor (#38 A): the parsed item as a list of
 * toggleable, editable filters. The stat rows are data-driven off the dictionary
 * (so new GGG stats appear automatically); item attributes come from the server's
 * attribute registry. The operator picks what to price and tweaks the values, then
 * prices — the server rebuilds the query from exactly these selections.
 */
export function PriceCheckEditor({ draft, onChange, onPrice, pricing }: PriceCheckEditorProps) {
  const t = useT();

  function patchFilter(id: string, next: (filter: PriceCheckFilter) => PriceCheckFilter): void {
    onChange({
      ...draft,
      filters: draft.filters.map((filter) => (filter.id === id ? next(filter) : filter)),
    });
  }

  function renderStat(filter: PriceCheckStatFilter) {
    return (
      <div className="flex flex-1 flex-wrap items-center gap-2">
        <span
          id={`pcf-${filter.id}`}
          className={`flex-1 text-xs ${filter.enabled ? 'text-ink' : 'text-ink-faint'}`}
        >
          {fillTemplate(filter.text, filter.rolls)}
          {filter.tier && (
            <span className="ml-1.5 text-[0.65rem] text-gold">
              T{filter.tier.tier} ({filter.tier.min}–{filter.tier.max})
            </span>
          )}
        </span>
        <label className="flex items-center gap-1 text-[0.65rem] text-ink-faint">
          {t('priceCheck.min')}
          <NumberInput
            steppers={false}
            className="w-16"
            value={filter.min?.toString() ?? ''}
            disabled={!filter.enabled}
            onValueChange={(raw) =>
              patchFilter(filter.id, (f) => ({ ...f, min: parseNumber(raw) }))
            }
          />
        </label>
        <label className="flex items-center gap-1 text-[0.65rem] text-ink-faint">
          {t('priceCheck.max')}
          <NumberInput
            steppers={false}
            className="w-16"
            value={filter.max?.toString() ?? ''}
            disabled={!filter.enabled}
            onValueChange={(raw) =>
              patchFilter(filter.id, (f) => ({ ...f, max: parseNumber(raw) }))
            }
          />
        </label>
      </div>
    );
  }

  function renderAttr(filter: PriceCheckAttrFilter) {
    const labelKey = ATTR_LABEL_KEYS[filter.attr];
    return (
      <div className="flex flex-1 flex-wrap items-center gap-2">
        <span
          id={`pcf-${filter.id}`}
          className={`flex-1 text-xs ${filter.enabled ? 'text-ink' : 'text-ink-faint'}`}
        >
          {labelKey ? t(labelKey) : filter.label}
        </span>
        {filter.inputType === 'number-min' && (
          <NumberInput
            steppers={false}
            className="w-16"
            value={typeof filter.value === 'number' ? filter.value.toString() : ''}
            disabled={!filter.enabled}
            onValueChange={(raw) =>
              patchFilter(filter.id, (f) => ({ ...f, value: parseNumber(raw) }))
            }
          />
        )}
        {filter.inputType === 'text' && (
          <span className="font-mono text-xs text-ink-muted">{String(filter.value ?? '')}</span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-edge bg-surface-1 p-4">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-medium text-ink">
          {draft.item.name ?? draft.item.baseType ?? t('priceCheck.unknownItem')}
        </span>
        {draft.item.baseType && draft.item.baseType !== draft.item.name && (
          <span className="text-xs text-ink-faint">{draft.item.baseType}</span>
        )}
        {draft.item.rarity && (
          <span className="text-[0.65rem] uppercase tracking-wide text-ink-faint">
            {draft.item.rarity}
          </span>
        )}
      </div>

      {draft.fixedValue && (
        <p className="text-xs text-ink-faint">{t('priceCheck.fixedValueNote')}</p>
      )}

      {draft.filters.length > 0 && (
        <ul className="flex flex-col divide-y divide-edge">
          {draft.filters.map((filter) => (
            <li key={filter.id} className="flex items-center gap-2 py-1.5">
              <input
                type="checkbox"
                checked={filter.enabled}
                aria-labelledby={`pcf-${filter.id}`}
                onChange={(event) =>
                  patchFilter(filter.id, (f) => ({ ...f, enabled: event.target.checked }))
                }
                className="h-3.5 w-3.5 accent-gold"
              />
              {filter.kind === 'stat' ? renderStat(filter) : renderAttr(filter)}
            </li>
          ))}
        </ul>
      )}

      {draft.unmatched.length > 0 && (
        <div>
          <p className="text-[0.65rem] uppercase tracking-wide text-ink-faint">
            {t('priceCheck.unmatchedTitle')}
          </p>
          <ul className="mt-1 space-y-0.5">
            {draft.unmatched.map((line, index) => (
              <li key={index} className="truncate text-xs text-ink-faint/70">
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <Button variant="primary" disabled={pricing} onClick={onPrice}>
          {pricing ? t('priceCheck.checking') : t('priceCheck.priceIt')}
        </Button>
      </div>
    </div>
  );
}
