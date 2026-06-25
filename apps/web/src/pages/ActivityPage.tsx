import { useEffect, useState } from 'react';
import type { ActivityRecord } from '@poe-sniper/shared';
import { ActivityCard } from '../components/ActivityCard';
import { useEventStream } from '../hooks/EventStreamProvider';
import { useT } from '../i18n/i18n';
import { apiGet } from '../lib/api';

/** Re-render cadence for the "x ago" labels. */
const TICK_MS = 5_000;

/**
 * Read-only operator activity timeline. Fetches /api/activity on mount and refetches
 * whenever a travel/buy event bumps `activityVersion`, so in-progress runs update live.
 */
export function ActivityPage() {
  const t = useT();
  const { activityVersion } = useEventStream();
  const [records, setRecords] = useState<ActivityRecord[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    apiGet<ActivityRecord[]>('/api/activity?limit=100')
      .then((data) => {
        if (!cancelled) setRecords(data);
      })
      .catch(() => {
        // transient — the next activityVersion bump refetches
      });
    return () => {
      cancelled = true;
    };
  }, [activityVersion]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <section className="flex max-w-3xl flex-col gap-3 p-4">
      <h1 className="text-lg font-semibold text-ink">{t('activity.title')}</h1>
      {records.length === 0 ? (
        <p className="text-sm text-ink-faint">{t('activity.empty')}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {records.map((record) => (
            <ActivityCard key={record.id} activity={record} nowMs={nowMs} />
          ))}
        </div>
      )}
    </section>
  );
}
