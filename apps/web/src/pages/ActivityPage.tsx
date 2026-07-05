import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BadgePercent, Coins, ShoppingCart, Zap, type LucideIcon } from 'lucide-react';
import { tradeSearchPageUrl } from '@poe-sniper/shared';
import { ActivityFeedCard } from '../components/ActivityFeedCard';
import { useActivityFeed, type FeedKind } from '../hooks/useActivityFeed';
import { useSearches } from '../hooks/useSearches';
import { spotlightSearch } from '../lib/search-spotlight';
import { useT } from '../i18n/i18n';
import type { MessageKey } from '../i18n/messages';

/** Re-render cadence for the "x ago" labels. */
const TICK_MS = 5_000;

const KIND_CHIPS: Array<{ kind: FeedKind; icon: LucideIcon; labelKey: MessageKey }> = [
  { kind: 'hit', icon: Zap, labelKey: 'activity.kind.hit' },
  { kind: 'deal', icon: BadgePercent, labelKey: 'activity.kind.deal' },
  { kind: 'price-check', icon: Coins, labelKey: 'activity.kind.priceCheck' },
  { kind: 'activity', icon: ShoppingCart, labelKey: 'activity.kind.buy' },
];
const ALL_KINDS: FeedKind[] = ['hit', 'deal', 'price-check', 'activity'];

/**
 * The unified Activity feed (#39): one chronological timeline of hits + price checks
 * + auto-buy/travel runs, in the Searches view's language. A filter-chip whitelist
 * on the right toggles visible kinds; each row expands to its event details, then the
 * item's mods.
 */
export function ActivityPage() {
  const t = useT();
  const navigate = useNavigate();
  const feed = useActivityFeed();
  const { searches } = useSearches();
  const [visible, setVisible] = useState<FeedKind[]>(ALL_KINDS);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const searchById = useMemo(
    () => new Map(searches.map((search) => [search.id, search])),
    [searches],
  );
  const shown = feed.filter((entry) => visible.includes(entry.kind));

  function toggleKind(kind: FeedKind): void {
    setVisible((current) =>
      current.includes(kind) ? current.filter((entry) => entry !== kind) : [...current, kind],
    );
  }

  function locate(searchId: string): void {
    spotlightSearch(searchId);
    void navigate('/');
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-ink">{t('activity.title')}</h1>
        <div className="flex flex-wrap gap-2">
          {KIND_CHIPS.map(({ kind, icon: Icon, labelKey }) => {
            const on = visible.includes(kind);
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={on}
                onClick={() => toggleKind(kind)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors ${
                  on
                    ? 'border-gold bg-surface-3 text-gold-bright'
                    : 'border-edge bg-surface-2 text-ink-muted hover:text-ink'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {t(labelKey)}
              </button>
            );
          })}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-ink-faint">{t('activity.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((entry) => {
            const searchId =
              entry.kind === 'hit' || entry.kind === 'deal'
                ? entry.hit.searchId
                : entry.kind === 'activity'
                  ? entry.record.searchId
                  : null;
            const search = searchId ? searchById.get(searchId) : undefined;
            return (
              <ActivityFeedCard
                key={entry.id}
                entry={entry}
                nowMs={nowMs}
                searchLabel={search?.label ?? null}
                tradeUrl={
                  search ? tradeSearchPageUrl(search.realm, search.league, search.id) : null
                }
                onLocateSearch={() => searchId && locate(searchId)}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}
