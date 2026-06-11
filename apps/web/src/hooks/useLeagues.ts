import { useEffect, useState } from 'react';
import type { LeagueInfo } from '@poe-sniper/shared';
import { apiGet } from '../lib/api';

/**
 * League list from the server (live trade-site data, cached server-side).
 * Empty result (e.g. no session yet) → the form falls back to free text.
 */
export function useLeagues(): { leagues: LeagueInfo[]; loaded: boolean } {
  const [leagues, setLeagues] = useState<LeagueInfo[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    apiGet<LeagueInfo[]>('/api/leagues')
      .then((rows) => {
        setLeagues(rows);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  return { leagues, loaded };
}
