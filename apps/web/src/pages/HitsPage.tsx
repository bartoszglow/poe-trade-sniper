import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import type { Hit } from '@poe-sniper/shared';
import { Field } from '../components/Field';
import { ItemDetailView } from '../components/ItemDetailView';
import { PriceTag } from '../components/PriceTag';
import { RarityName } from '../components/RarityName';
import { Select } from '../components/Select';
import { TextInput } from '../components/TextInput';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useSearches } from '../hooks/useSearches';
import { useT } from '../i18n/i18n';
import { apiGet } from '../lib/api';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

type SortOption = 'newest' | 'oldest' | 'name';

interface Filters {
  searchId: string;
  text: string;
  from: string;
  to: string;
  sort: SortOption;
}

const EMPTY_FILTERS: Filters = { searchId: '', text: '', from: '', to: '', sort: 'newest' };

/** Build the /api/hits query for a page, translating date inputs to ISO bounds. */
function buildQuery(filters: Filters, offset: number): string {
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(offset),
    sort: filters.sort,
  });
  if (filters.searchId) params.set('searchId', filters.searchId);
  if (filters.text.trim()) params.set('search', filters.text.trim());
  if (filters.from) params.set('from', `${filters.from}T00:00:00.000Z`);
  if (filters.to) params.set('to', `${filters.to}T23:59:59.999Z`);
  return params.toString();
}

export function HitsPage() {
  const t = useT();
  const { searches } = useSearches();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  // Debounce the free-text box so we don't refetch on every keystroke.
  const debouncedText = useDebouncedValue(filters.text, SEARCH_DEBOUNCE_MS);
  const [hits, setHits] = useState<Hit[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [expandedHitId, setExpandedHitId] = useState<number | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  // Guards the IntersectionObserver against firing mid-load or after the page edge.
  const loadingRef = useRef(false);
  // Next offset to fetch — a ref so loadPage reads the current value without
  // being recreated (and resetting itself) every time it changes.
  const offsetRef = useRef(0);

  const { searchId, from, to, sort } = filters;
  const loadPage = useCallback(
    (reset: boolean) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      const startOffset = reset ? 0 : offsetRef.current;
      const query = buildQuery({ searchId, text: debouncedText, from, to, sort }, startOffset);
      apiGet<Hit[]>(`/api/hits?${query}`)
        .then((page) => {
          setHits((previous) => (reset ? page : [...previous, ...page]));
          offsetRef.current = startOffset + page.length;
          setHasMore(page.length === PAGE_SIZE);
        })
        .catch(() => {
          if (reset) setHits([]);
          setHasMore(false);
        })
        .finally(() => {
          loadingRef.current = false;
          setLoading(false);
        });
    },
    [searchId, debouncedText, from, to, sort],
  );

  // Any filter change resets to page 0.
  useEffect(() => {
    loadPage(true);
  }, [loadPage]);

  // Infinite scroll: load the next page when the sentinel scrolls into view.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadPage(false);
      },
      { rootMargin: '120px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadPage]);

  const filterOptions = [
    { value: '', label: t('hits.allSearches') },
    ...searches.map((search) => ({ value: search.id, label: search.label })),
  ];

  function patch(next: Partial<Filters>): void {
    setFilters((previous) => ({ ...previous, ...next }));
  }

  return (
    <section className="flex h-full flex-col gap-3">
      <h1 className="text-lg font-semibold text-ink">{t('hits.title')}</h1>

      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('hits.filterBySearch')}>
          <Select
            ariaLabel={t('hits.filterBySearch')}
            value={filters.searchId}
            onChange={(searchId) => patch({ searchId })}
            options={filterOptions}
            className="w-48"
          />
        </Field>
        <Field label={t('hits.searchPlaceholder')}>
          <TextInput
            value={filters.text}
            onChange={(changeEvent) => patch({ text: changeEvent.target.value })}
            placeholder={t('hits.searchPlaceholder')}
            className="w-56"
          />
        </Field>
        <Field label={t('hits.from')}>
          <TextInput
            type="date"
            value={filters.from}
            onChange={(changeEvent) => patch({ from: changeEvent.target.value })}
          />
        </Field>
        <Field label={t('hits.to')}>
          <TextInput
            type="date"
            value={filters.to}
            onChange={(changeEvent) => patch({ to: changeEvent.target.value })}
          />
        </Field>
        <Field label={t('hits.sort')}>
          <Select
            ariaLabel={t('hits.sort')}
            value={filters.sort}
            onChange={(sort) => patch({ sort: sort as SortOption })}
            options={[
              { value: 'newest', label: t('hits.sortNewest') },
              { value: 'oldest', label: t('hits.sortOldest') },
              { value: 'name', label: t('hits.sortName') },
            ]}
            className="w-36"
          />
        </Field>
      </div>

      {hits.length === 0 && !loading ? (
        <p className="text-sm text-ink-faint">{t('hits.empty')}</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
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

          {/* Sentinel + loading animation for infinite scroll. */}
          <div ref={sentinelRef} className="flex justify-center py-3">
            {loading && (
              <span className="flex items-center gap-2 text-xs text-ink-faint">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('hits.loading')}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
