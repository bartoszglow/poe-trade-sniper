import type { SearchRuntimeInfo } from '@poe-sniper/shared';
import { useT } from '../../i18n/i18n';
import { QueryCriteriaView } from '../QueryCriteriaView';

interface ItemCardProps {
  search: SearchRuntimeInfo;
}

/**
 * The unified panel's item section (plan 42): the search's criteria as today,
 * plus — while deal mode holds the row's price filter parked — a note so the
 * operator understands why the visible price cap is the AUTO one.
 */
export function ItemCard({ search }: ItemCardProps) {
  const t = useT();
  return (
    <section className="rounded-md border border-edge bg-surface-2 p-3">
      <h3 className="text-xs font-medium tracking-wide text-ink-muted uppercase">
        {t('searchPanel.item')}
      </h3>
      <div className="mt-2">
        <QueryCriteriaView query={search.filters} />
      </div>
      {search.dealWatch !== null && (
        <p className="mt-2 text-xs text-ink-faint">{t('dealWatch.itemPriceParked')}</p>
      )}
    </section>
  );
}
