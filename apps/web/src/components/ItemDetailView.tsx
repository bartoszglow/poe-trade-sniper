import type { ReactNode } from 'react';
import type { ItemDetail } from '@poe-sniper/shared';
import { useT } from '../i18n/i18n';

/** Wrap numeric rolls in gold so the eye lands on the value (game/trade-tooltip feel). */
function highlightRolls(text: string): ReactNode {
  const parts = text.split(/(\d+(?:\.\d+)?)/g);
  return parts.map((part, index) =>
    /^\d/.test(part) ? (
      <span key={index} className="text-gold-bright">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/** One mod group (implicit / explicit / rune / crafted) — a divider between groups. */
function ModGroup({ mods, className }: { mods: string[]; className: string }) {
  if (mods.length === 0) return null;
  return (
    <div className="border-t border-edge py-1.5 first:border-t-0 first:pt-0">
      {mods.map((mod) => (
        <div key={mod} className={`text-xs leading-relaxed ${className}`}>
          {highlightRolls(mod)}
        </div>
      ))}
    </div>
  );
}

/**
 * The normalized item, laid out like a compact game/trade tooltip (#39 restyle):
 * a wrapped identity/properties/requirements line, then the mods as domain-accented
 * groups with the rolls highlighted, on a `surface-2` inset. Shared by the Activity
 * feed and the Hits view, so both read consistently.
 */
export function ItemDetailView({ item }: { item: ItemDetail }) {
  const t = useT();

  const identity: string[] = [];
  if (item.baseType) identity.push(item.baseType);
  if (item.itemLevel !== null) identity.push(`${t('item.itemLevel')} ${item.itemLevel}`);
  for (const property of item.properties) {
    identity.push(property.value ? `${property.label} ${property.value}` : property.label);
  }
  for (const requirement of item.requirements) {
    identity.push(
      requirement.value ? `${requirement.label} ${requirement.value}` : requirement.label,
    );
  }

  const hasMods =
    item.implicitMods.length > 0 ||
    item.explicitMods.length > 0 ||
    item.runeMods.length > 0 ||
    item.craftedMods.length > 0;

  return (
    <div className="rounded-md border border-edge bg-surface-2 px-3 py-2">
      {(identity.length > 0 || item.corrupted) && (
        <div className="mb-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[0.7rem] text-ink-muted">
          {identity.map((part, index) => (
            <span key={index}>
              {index > 0 && <span className="text-ink-faint">· </span>}
              {highlightRolls(part)}
            </span>
          ))}
          {item.corrupted && <span className="text-danger">{t('item.corrupted')}</span>}
        </div>
      )}
      {hasMods && (
        <div>
          <ModGroup mods={item.implicitMods} className="text-ink-faint italic" />
          <ModGroup mods={item.explicitMods} className="text-ink" />
          <ModGroup mods={item.runeMods} className="text-gold" />
          <ModGroup mods={item.craftedMods} className="text-info" />
        </div>
      )}
    </div>
  );
}
