import { useEffect, useState } from 'react';
import type { StatDictionaryEntry } from '@poe-sniper/shared';
import { apiGet } from '../lib/api';

/**
 * Stat-id → label map for the criteria view. Fetched lazily on first use and
 * cached for the session (module scope) — the server caches the GGG call too,
 * so opening many accordions costs one request total.
 */
let cachedMap: Map<string, string> | null = null;
let inFlight: Promise<Map<string, string>> | null = null;

async function loadStatsDictionary(): Promise<Map<string, string>> {
  if (cachedMap) return cachedMap;
  inFlight ??= apiGet<StatDictionaryEntry[]>('/api/stats')
    .then((entries) => {
      cachedMap = new Map(entries.map((entry) => [entry.id, entry.text]));
      return cachedMap;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** null while loading or on failure — the view then shows raw stat ids. */
export function useStatsDictionary(): Map<string, string> | null {
  const [statsById, setStatsById] = useState<Map<string, string> | null>(cachedMap);

  useEffect(() => {
    if (statsById) return;
    let cancelled = false;
    loadStatsDictionary()
      .then((map) => {
        if (!cancelled) setStatsById(map);
      })
      .catch(() => {
        // No dictionary (e.g. no session yet) — raw ids still render.
      });
    return () => {
      cancelled = true;
    };
  }, [statsById]);

  return statsById;
}
