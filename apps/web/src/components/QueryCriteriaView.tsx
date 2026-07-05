import { useMemo } from 'react';
import { useStatsDictionary } from '../hooks/useStatsDictionary';
import { useT } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';
import type { DetailRowData } from '../lib/detail-layout';
import {
  filterLabel,
  parseQueryCriteria,
  type CriteriaRow,
  type ParsedCriteria,
} from '../lib/query-criteria';
import { DetailCard, DetailRows } from './DetailCard';

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

/** Map parsed criteria rows to the shared DetailRows model; a disabled group marks
 *  all its rows disabled. Empty values collapse to label-only rows. */
function toRows(rows: CriteriaRow[], disabledTag: string, groupDisabled = false): DetailRowData[] {
  return rows.map((row) => ({
    label: row.label,
    value: row.value || undefined,
    disabled: groupDisabled || row.disabled,
    disabledTag,
  }));
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
 * actually match" panel, laid out as group boxes in an INTRINSIC grid: column
 * count follows the container's available width (auto-fit), not the viewport,
 * so the same component packs 1 column in the panel's half-width cell and 3-4
 * in the full-width add-form preview. Unrecognized parts render raw
 * (lib/query-criteria never drops data); stat ids resolve via the cached
 * dictionary, falling back to raw ids while it loads.
 */
export function QueryCriteriaView({
  query,
  divineRate = null,
  /** Hide the "Item" group chip — its host already frames the section (plan 42). */
  hideItemLabel = false,
}: {
  query: unknown;
  divineRate?: number | null;
  hideItemLabel?: boolean;
}) {
  const t = useT();
  const statsById = useStatsDictionary();
  const criteria = useMemo(
    () => parseQueryCriteria(query, statsById, divineRate),
    [query, statsById, divineRate],
  );

  if (!hasAnyContent(criteria)) {
    return <p className="text-xs text-ink-faint">{t('criteria.empty')}</p>;
  }

  const disabledTag = t('criteria.disabledTag');
  const statusLabel = criteria.statusOption
    ? (STATUS_OPTION_LABELS[criteria.statusOption] ?? criteria.statusOption)
    : null;

  const purchaseRows: DetailRowData[] = [];
  if (statusLabel) {
    purchaseRows.push({
      label: statusLabel,
      value: statusLabel !== criteria.statusOption ? `(${criteria.statusOption ?? ''})` : undefined,
    });
  }
  if (criteria.price) {
    purchaseRows.push({ label: t('criteria.price'), value: criteria.price, accent: true });
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-x-2.5 gap-y-5">
      {criteria.itemRows.length > 0 && (
        <DetailCard title={hideItemLabel ? undefined : t('criteria.item')}>
          <DetailRows rows={toRows(criteria.itemRows, disabledTag)} />
        </DetailCard>
      )}

      {purchaseRows.length > 0 && (
        <DetailCard title={t('criteria.purchase')}>
          <DetailRows rows={purchaseRows} />
        </DetailCard>
      )}

      {criteria.statGroups.map((group, index) => (
        <DetailCard key={`stats-${index}`} title={`${t('criteria.stats')} · ${group.heading}`}>
          <DetailRows rows={toRows(group.rows, disabledTag, group.disabled)} />
        </DetailCard>
      ))}

      {criteria.filterGroups.map((group) => {
        const titleKey = GROUP_TITLE_KEYS[group.key];
        return (
          <DetailCard key={group.key} title={titleKey ? t(titleKey) : filterLabel(group.key)}>
            <DetailRows rows={toRows(group.rows, disabledTag, group.disabled)} />
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
