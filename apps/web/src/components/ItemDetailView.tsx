import type { ItemDetail, ItemProperty } from '@poe-sniper/shared';
import { useT } from '../i18n/i18n';

function PropertyList({ title, properties }: { title: string; properties: ItemProperty[] }) {
  if (properties.length === 0) return null;
  return (
    <div>
      <div className="text-[0.65rem] tracking-widest text-ink-faint uppercase">{title}</div>
      <ul className="mt-0.5">
        {properties.map((property) => (
          <li key={property.label} className="text-xs text-ink-muted">
            {property.label}
            {property.value && <span className="text-ink">: {property.value}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ModList({ mods, className }: { mods: string[]; className: string }) {
  if (mods.length === 0) return null;
  return (
    <ul>
      {mods.map((mod) => (
        <li key={mod} className={`text-xs ${className}`}>
          {mod}
        </li>
      ))}
    </ul>
  );
}

/** Renders the normalized item payload — trade-site-ish mod coloring. */
export function ItemDetailView({ item }: { item: ItemDetail }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2 border-t border-edge pt-2">
      <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-ink-faint">
        {item.baseType && <span>{item.baseType}</span>}
        {item.itemLevel !== null && <span>{t('item.ilvl', { level: item.itemLevel })}</span>}
        {item.corrupted && <span className="text-danger">{t('item.corrupted')}</span>}
      </div>
      <PropertyList title={t('item.properties')} properties={item.properties} />
      <PropertyList title={t('item.requirements')} properties={item.requirements} />
      <ModList mods={item.implicitMods} className="text-ink-muted italic" />
      <ModList mods={item.explicitMods} className="text-rarity-magic" />
      <ModList mods={item.runeMods} className="text-gold" />
      <ModList mods={item.craftedMods} className="text-info" />
    </div>
  );
}
