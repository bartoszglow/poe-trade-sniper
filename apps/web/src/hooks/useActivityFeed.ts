import { useEffect, useMemo, useState } from 'react';
import type { ActivityRecord, Hit } from '@poe-sniper/shared';
import { apiGet } from '../lib/api';
import { feedKindForHit } from '../lib/deal-display';
import { useEventStream } from './EventStreamProvider';
import { usePriceCheck, type PriceCheckEntry } from './usePriceCheck';

/** The event kinds the unified Activity feed merges (#39; 'deal' = plan 41). */
export type FeedKind = 'hit' | 'deal' | 'price-check' | 'activity';

/** One entry in the merged feed — a discriminated union carrying the source item. */
export type FeedEntry = { id: string; kind: FeedKind; atMs: number } & (
  | { kind: 'hit'; hit: Hit }
  /** A deal-mode hit (row.deal non-null) — same source row, its own feed kind. */
  | { kind: 'deal'; hit: Hit }
  | { kind: 'price-check'; entry: PriceCheckEntry }
  | { kind: 'activity'; record: ActivityRecord }
);

/** Cap on the merged feed — a recent timeline, not an audit dump (D-act-4). */
const FEED_CAP = 200;
/** Per-source fetch limits (hits dominate volume). */
const FETCH_LIMIT = 150;

/**
 * Merges the operator's three activity sources into one chronological feed (#39):
 * detections (`/api/hits`), price checks (the reactive `usePriceCheck` history, itself
 * DB-seeded) and auto-buy/travel runs (`/api/activity`). Refetches activity on an
 * `activityVersion` bump and hits when a new hit lands; price checks are already live.
 * Returns newest-first, capped. The caller filters by the visible-kind whitelist.
 */
export function useActivityFeed(): FeedEntry[] {
  const { activityVersion, lastHitAtBySearchId } = useEventStream();
  const { history } = usePriceCheck();
  const [activity, setActivity] = useState<ActivityRecord[]>([]);
  const [hits, setHits] = useState<Hit[]>([]);

  useEffect(() => {
    let cancelled = false;
    apiGet<ActivityRecord[]>(`/api/activity?limit=${FETCH_LIMIT}`)
      .then((data) => {
        if (!cancelled) setActivity(data);
      })
      .catch(() => {
        /* transient — the next activityVersion bump refetches */
      });
    return () => {
      cancelled = true;
    };
  }, [activityVersion]);

  // A new hit anywhere changes the joined last-hit timestamps → refetch the list.
  const hitSignal = Object.values(lastHitAtBySearchId).sort().join('|');
  useEffect(() => {
    let cancelled = false;
    apiGet<Hit[]>(`/api/hits?limit=${FETCH_LIMIT}`)
      .then((data) => {
        if (!cancelled) setHits(data);
      })
      .catch(() => {
        /* transient — the next hit refetches */
      });
    return () => {
      cancelled = true;
    };
  }, [hitSignal]);

  return useMemo(() => {
    const entries: FeedEntry[] = [
      ...hits.map(
        (hit): FeedEntry => ({
          id: `h:${hit.id}`,
          kind: feedKindForHit(hit),
          atMs: Date.parse(hit.detectedAt),
          hit,
        }),
      ),
      ...history.map(
        (entry): FeedEntry => ({ id: `p:${entry.id}`, kind: 'price-check', atMs: entry.at, entry }),
      ),
      ...activity.map(
        (record): FeedEntry => ({
          id: `a:${record.id}`,
          kind: 'activity',
          atMs: Date.parse(record.startedAt),
          record,
        }),
      ),
    ];
    entries.sort((first, second) => second.atMs - first.atMs);
    return entries.slice(0, FEED_CAP);
  }, [hits, history, activity]);
}
