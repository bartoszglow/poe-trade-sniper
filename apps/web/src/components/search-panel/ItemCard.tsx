import type { SearchRuntimeInfo } from '@poe-sniper/shared';
import { useT } from '../../i18n/i18n';
import { QueryCriteriaView } from '../QueryCriteriaView';

interface ItemCardProps {
  search: SearchRuntimeInfo;
}

/**
 * The unified panel's item section (plan 42): the criteria group boxes render
 * DIRECTLY in the panel cell — they are bordered cards themselves, so an extra
 * wrapper card (and an "Item" heading, operator feedback 2026-07-05) was pure
 * chrome. While deal mode holds the row's price filter parked, a note explains
 * why the visible price cap is the AUTO one.
 */
export function ItemCard({ search }: ItemCardProps) {
  const t = useT();
  return (
    <div className="pt-2">
      <QueryCriteriaView
        query={search.filters}
        divineRate={search.dealWatch?.divinePriceExalted ?? null}
        hideItemLabel
      />
      {search.dealWatch !== null && (
        <p className="mt-2.5 text-[11px] leading-snug text-ink-faint">
          {t('dealWatch.itemPriceParked')}
        </p>
      )}
    </div>
  );
}
