import type { SearchRuntimeInfo } from '@poe-sniper/shared';
import { useT } from '../../i18n/i18n';
import { QueryCriteriaView } from '../QueryCriteriaView';

interface ItemCardProps {
  search: SearchRuntimeInfo;
}

/**
 * The unified panel's item section (plan 42): the criteria group boxes render
 * DIRECTLY in the panel cell — no wrapper card heading (operator feedback
 * 2026-07-05), but the "Item" GROUP chip stays so the group chips read as one
 * consistent family (ITEM / PURCHASE / … — operator iteration, same day).
 * While deal mode holds the row's price filter parked, a note explains why the
 * visible price cap is the AUTO one.
 */
export function ItemCard({ search }: ItemCardProps) {
  const t = useT();
  return (
    <div className="pt-2">
      <QueryCriteriaView
        query={search.filters}
        divineRate={search.dealWatch?.divinePriceExalted ?? null}
      />
      {search.dealWatch !== null && (
        <p className="mt-2.5 text-[11px] leading-snug text-ink-faint">
          {t('dealWatch.itemPriceParked')}
        </p>
      )}
    </div>
  );
}
