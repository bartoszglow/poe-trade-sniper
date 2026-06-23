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
import { DetailCard, DetailRow } from './DetailCard';

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

function RowItems({ rows, disabledTag }: { rows: CriteriaRow[]; disabledTag: string }) {
  return (
    <>
      {rows.map((row, index) => (
        <DetailRow
          key={`${row.label}-${index}`}
          label={row.label}
          value={row.value}
          disabled={row.disabled}
          disabledTag={disabledTag}
        />
      ))}
    </>
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
 * actually match" panel, laid out as group boxes in a responsive grid
 * (1 → 2 → 3 columns). Unrecognized parts render raw (lib/query-criteria never
 * drops data); stat ids resolve via the cached dictionary, falling back to raw
 * ids while it loads.
 */
export function QueryCriteriaView({ query }: { query: unknown }) {
  const t = useT();
  const statsById = useStatsDictionary();
  const criteria = useMemo(() => parseQueryCriteria(query, statsById), [query, statsById]);

  if (!hasAnyContent(criteria)) {
    return <p className="text-xs text-ink-faint">{t('criteria.empty')}</p>;
  }

  const disabledTag = t('criteria.disabledTag');
  const statusLabel = criteria.statusOption
    ? (STATUS_OPTION_LABELS[criteria.statusOption] ?? criteria.statusOption)
    : null;

  return (
    <div className="grid grid-cols-1 gap-x-2 gap-y-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {criteria.itemRows.length > 0 && (
        <DetailCard title={t('criteria.item')}>
          <RowItems rows={criteria.itemRows} disabledTag={disabledTag} />
        </DetailCard>
      )}

      {(statusLabel || criteria.price) && (
        <DetailCard title={t('criteria.purchase')}>
          {statusLabel && (
            <DetailRow
              label={statusLabel}
              value={
                statusLabel !== criteria.statusOption
                  ? `(${criteria.statusOption ?? ''})`
                  : undefined
              }
            />
          )}
          {criteria.price && (
            <DetailRow label={t('criteria.price')} value={criteria.price} accent />
          )}
        </DetailCard>
      )}

      {criteria.statGroups.map((group, index) => (
        <DetailCard key={`stats-${index}`} title={`${t('criteria.stats')} · ${group.heading}`}>
          <RowItems
            rows={
              group.disabled ? group.rows.map((row) => ({ ...row, disabled: true })) : group.rows
            }
            disabledTag={disabledTag}
          />
        </DetailCard>
      ))}

      {criteria.filterGroups.map((group) => {
        const titleKey = GROUP_TITLE_KEYS[group.key];
        return (
          <DetailCard key={group.key} title={titleKey ? t(titleKey) : filterLabel(group.key)}>
            <RowItems
              rows={
                group.disabled ? group.rows.map((row) => ({ ...row, disabled: true })) : group.rows
              }
              disabledTag={disabledTag}
            />
          </DetailCard>
        );
      })}

      {criteria.unknownRows.length > 0 && (
        <DetailCard title={t('criteria.other')}>
          {criteria.unknownRows.map((row) => (
            <div key={row.label} className="font-mono text-[0.65rem] break-all text-ink-faint">
              {row.label}: {row.value}
            </div>
          ))}
        </DetailCard>
      )}
    </div>
  );
}
