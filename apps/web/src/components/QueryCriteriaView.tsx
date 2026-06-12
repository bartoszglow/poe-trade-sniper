import { useMemo } from 'react';
import { useStatsDictionary } from '../hooks/useStatsDictionary';
import { useT } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';
import {
  filterLabel,
  parseQueryCriteria,
  type CriteriaRow,
  type ParsedCriteria,
} from '../lib/query-criteria';

/** Best-effort `status.option` labels (only `securable` is a verified mapping). */
const STATUS_OPTION_LABELS: Record<string, string> = {
  securable: 'Instant Buyout',
  online: 'Online',
  onlineleague: 'Online in League',
  any: 'Any',
};

/** Known filter-group keys → catalog titles; unknown groups show their raw key. */
const GROUP_TITLE_KEYS: Record<string, MessageKey> = {
  type_filters: 'criteria.group.type',
  equipment_filters: 'criteria.group.equipment',
  req_filters: 'criteria.group.requirements',
  misc_filters: 'criteria.group.misc',
  trade_filters: 'criteria.group.trade',
};

function SectionLabel({ text }: { text: string }) {
  return (
    <span className="w-24 shrink-0 text-[0.65rem] font-semibold tracking-widest text-ink-faint uppercase">
      {text}
    </span>
  );
}

function RowList({ rows, disabledTag }: { rows: CriteriaRow[]; disabledTag: string }) {
  return (
    <ul className="min-w-0 flex-1">
      {rows.map((row, index) => (
        <li
          key={`${row.label}-${index}`}
          className={`flex flex-wrap items-baseline gap-x-2 text-xs ${
            row.disabled ? 'text-ink-faint line-through' : 'text-ink-muted'
          }`}
        >
          <span>{row.label}</span>
          {row.value && <span className={row.disabled ? '' : 'text-ink'}>{row.value}</span>}
          {row.disabled && <span className="no-underline">({disabledTag})</span>}
        </li>
      ))}
    </ul>
  );
}

function hasAnyContent(criteria: ParsedCriteria): boolean {
  return (
    criteria.itemRows.length > 0 ||
    criteria.statusOption !== null ||
    criteria.price !== null ||
    criteria.statGroups.length > 0 ||
    criteria.filterGroups.length > 0 ||
    criteria.unknownRows.length > 0
  );
}

/**
 * Humanized rendering of a resolved trade query — the "what does this search
 * actually match" panel. Unrecognized parts render raw (lib/query-criteria
 * never drops data); stat ids resolve via the cached dictionary and fall back
 * to raw ids while it loads.
 */
export function QueryCriteriaView({ query }: { query: unknown }) {
  const t = useT();
  const statsById = useStatsDictionary();
  const criteria = useMemo(() => parseQueryCriteria(query, statsById), [query, statsById]);

  if (!hasAnyContent(criteria)) {
    return <p className="text-xs text-ink-faint">{t('criteria.empty')}</p>;
  }

  const statusLabel = criteria.statusOption
    ? (STATUS_OPTION_LABELS[criteria.statusOption] ?? criteria.statusOption)
    : null;

  return (
    <div className="flex flex-col gap-1.5">
      {criteria.itemRows.length > 0 && (
        <div className="flex gap-2">
          <SectionLabel text={t('criteria.item')} />
          <RowList rows={criteria.itemRows} disabledTag={t('criteria.disabledTag')} />
        </div>
      )}

      {statusLabel && (
        <div className="flex gap-2">
          <SectionLabel text={t('criteria.purchase')} />
          <span className="text-xs text-ink-muted">
            {statusLabel}
            {statusLabel !== criteria.statusOption && (
              <span className="text-ink-faint"> ({criteria.statusOption})</span>
            )}
          </span>
        </div>
      )}

      {criteria.price && (
        <div className="flex gap-2">
          <SectionLabel text={t('criteria.price')} />
          <span className="font-mono text-xs text-gold-bright">{criteria.price}</span>
        </div>
      )}

      {criteria.statGroups.map((group, index) => (
        <div key={`stats-${index}`} className="flex gap-2">
          <SectionLabel
            text={`${t('criteria.stats')} (${group.heading})${group.disabled ? ' ✕' : ''}`}
          />
          <RowList
            rows={
              group.disabled ? group.rows.map((row) => ({ ...row, disabled: true })) : group.rows
            }
            disabledTag={t('criteria.disabledTag')}
          />
        </div>
      ))}

      {criteria.filterGroups.map((group) => {
        const titleKey = GROUP_TITLE_KEYS[group.key];
        return (
          <div key={group.key} className="flex gap-2">
            <SectionLabel text={titleKey ? t(titleKey) : filterLabel(group.key)} />
            <RowList
              rows={
                group.disabled ? group.rows.map((row) => ({ ...row, disabled: true })) : group.rows
              }
              disabledTag={t('criteria.disabledTag')}
            />
          </div>
        );
      })}

      {criteria.unknownRows.length > 0 && (
        <div className="flex gap-2">
          <SectionLabel text={t('criteria.other')} />
          <ul className="min-w-0 flex-1">
            {criteria.unknownRows.map((row) => (
              <li key={row.label} className="font-mono text-[0.65rem] break-all text-ink-faint">
                {row.label}: {row.value}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
