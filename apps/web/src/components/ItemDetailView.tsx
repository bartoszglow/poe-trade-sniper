import type { ItemDetail, ItemProperty } from '@poe-sniper/shared';
import { useT } from '../i18n/i18n';
import type { DetailRowData } from '../lib/detail-layout';
import { DetailCard, DetailRows } from './DetailCard';

function propertyRows(properties: ItemProperty[]): DetailRowData[] {
  return properties.map((property) => ({
    label: property.label,
    value: property.value ?? undefined,
  }));
}

function ModLines({ mods, className }: { mods: string[]; className: string }) {
  return (
    <>
      {mods.map((mod) => (
        <div key={mod} className={`text-xs ${className}`}>
          {mod}
        </div>
      ))}
    </>
  );
}

/**
 * The normalized item payload, laid out as the same group cards as the search
 * criteria view (DetailCard + DetailRows) so the two read consistently — scalar
 * groups pack into columns, longer ones drop to one-per-line, via the shared
 * layout logic. Mods keep their trade-site coloring.
 */
export function ItemDetailView({
  item,
  columns = 'auto',
}: {
  item: ItemDetail;
  /** 'auto' = responsive multi-column grid (default); 'single' = always one column,
   *  for use inside a narrow container (e.g. the Activity card's right column). */
  columns?: 'auto' | 'single';
}) {
  const t = useT();
  const hasIdentity = Boolean(item.baseType) || item.itemLevel !== null || item.corrupted;
  const hasMods =
    item.implicitMods.length > 0 ||
    item.explicitMods.length > 0 ||
    item.runeMods.length > 0 ||
    item.craftedMods.length > 0;

  const identityRows: DetailRowData[] = [];
  if (item.baseType) identityRows.push({ label: t('item.base'), value: item.baseType });
  if (item.itemLevel !== null) {
    identityRows.push({ label: t('item.itemLevel'), value: String(item.itemLevel) });
  }

  return (
    <div
      className={
        columns === 'single'
          ? 'grid grid-cols-1 gap-2'
          : 'grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3'
      }
    >
      {hasIdentity && (
        <DetailCard title={t('item.title')}>
          <DetailRows rows={identityRows} />
          {item.corrupted && <div className="mt-1 text-xs text-danger">{t('item.corrupted')}</div>}
        </DetailCard>
      )}

      {item.properties.length > 0 && (
        <DetailCard title={t('item.properties')}>
          <DetailRows rows={propertyRows(item.properties)} />
        </DetailCard>
      )}

      {item.requirements.length > 0 && (
        <DetailCard title={t('item.requirements')}>
          <DetailRows rows={propertyRows(item.requirements)} />
        </DetailCard>
      )}

      {hasMods && (
        <DetailCard title={t('item.mods')}>
          <ModLines mods={item.implicitMods} className="text-ink-muted italic" />
          <ModLines mods={item.explicitMods} className="text-rarity-magic" />
          <ModLines mods={item.runeMods} className="text-gold" />
          <ModLines mods={item.craftedMods} className="text-info" />
        </DetailCard>
      )}
    </div>
  );
}
