import type { ItemDetail, ItemProperty } from '@poe-sniper/shared';
import { useT } from '../i18n/i18n';
import { DetailCard, DetailRow } from './DetailCard';

function PropertyRows({ properties }: { properties: ItemProperty[] }) {
  return (
    <>
      {properties.map((property) => (
        <DetailRow
          key={property.label}
          label={property.label}
          value={property.value ?? undefined}
        />
      ))}
    </>
  );
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
 * criteria view (DetailCard grid) so the two read consistently. Mods keep their
 * trade-site coloring.
 */
export function ItemDetailView({ item }: { item: ItemDetail }) {
  const t = useT();
  const hasIdentity = Boolean(item.baseType) || item.itemLevel !== null || item.corrupted;
  const hasMods =
    item.implicitMods.length > 0 ||
    item.explicitMods.length > 0 ||
    item.runeMods.length > 0 ||
    item.craftedMods.length > 0;

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {hasIdentity && (
        <DetailCard title={t('item.title')}>
          {item.baseType && <DetailRow label={t('item.base')} value={item.baseType} />}
          {item.itemLevel !== null && (
            <DetailRow label={t('item.itemLevel')} value={String(item.itemLevel)} />
          )}
          {item.corrupted && <div className="text-xs text-danger">{t('item.corrupted')}</div>}
        </DetailCard>
      )}

      {item.properties.length > 0 && (
        <DetailCard title={t('item.properties')}>
          <PropertyRows properties={item.properties} />
        </DetailCard>
      )}

      {item.requirements.length > 0 && (
        <DetailCard title={t('item.requirements')}>
          <PropertyRows properties={item.requirements} />
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
