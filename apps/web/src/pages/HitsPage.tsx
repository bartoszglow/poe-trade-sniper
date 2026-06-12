import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import type { Hit } from '@poe-sniper/shared';
import { Button } from '../components/Button';
import { ItemDetailView } from '../components/ItemDetailView';
import { PriceTag } from '../components/PriceTag';
import { RarityName } from '../components/RarityName';
import { Select } from '../components/Select';
import { useEventStream } from '../hooks/EventStreamProvider';
import { useSearches } from '../hooks/useSearches';
import { useT } from '../i18n/i18n';
import { apiGet } from '../lib/api';

const HISTORY_LIMIT = 50;

export function HitsPage() {
  const t = useT();
  const { liveHits } = useEventStream();
  const { searches } = useSearches();
  const [hits, setHits] = useState<Hit[]>([]);
  const [searchFilter, setSearchFilter] = useState('');
  const [expandedHitId, setExpandedHitId] = useState<number | null>(null);

  const refresh = useCallback(() => {
    const query = searchFilter ? `&searchId=${encodeURIComponent(searchFilter)}` : '';
    apiGet<Hit[]>(`/api/hits?limit=${HISTORY_LIMIT}${query}`)
      .then(setHits)
      .catch(() => setHits([]));
  }, [searchFilter]);

  // liveHits.length: a new detection means a new persisted row — refetch.
  useEffect(() => {
    refresh();
  }, [refresh, liveHits.length]);

  const filterOptions = [
    { value: '', label: t('hits.allSearches') },
    ...searches.map((search) => ({ value: search.id, label: search.label })),
  ];

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-semibold text-ink">{t('hits.title')}</h1>
        <div className="flex-1" />
        <Select
          aria-label={t('hits.filterBySearch')}
          value={searchFilter}
          onChange={(changeEvent) => setSearchFilter(changeEvent.target.value)}
          options={filterOptions}
        />
        <Button variant="ghost" onClick={refresh}>
          <RefreshCw className="h-3.5 w-3.5" />
          {t('common.refresh')}
        </Button>
      </div>

      {hits.length === 0 ? (
        <p className="text-sm text-ink-faint">{t('hits.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {hits.map((hit) => {
            const expanded = expandedHitId === hit.id;
            return (
              <li key={hit.id} className="rounded-md border border-edge bg-surface-1 px-3 py-2">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 text-left"
                  aria-expanded={expanded}
                  onClick={() => setExpandedHitId(expanded ? null : hit.id)}
                >
                  {expanded ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                  )}
                  <span className="font-mono text-[0.65rem] text-ink-faint">
                    {new Date(hit.detectedAt).toLocaleString()}
                  </span>
                  <RarityName name={hit.itemName} rarity={hit.item?.rarity ?? null} />
                  <div className="flex-1" />
                  <PriceTag price={hit.price} />
                  {hit.seller && (
                    <span className="hidden truncate text-xs text-ink-faint sm:inline">
                      {hit.seller}
                    </span>
                  )}
                </button>
                {expanded &&
                  (hit.item ? (
                    <div className="mt-2 pl-5">
                      <ItemDetailView item={hit.item} />
                    </div>
                  ) : (
                    <p className="mt-2 pl-5 text-xs text-ink-faint">{t('hits.noItemPayload')}</p>
                  ))}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
