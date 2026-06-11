import { useCallback, useEffect, useState } from 'react';
import type { PurchaseMode, SearchRuntimeInfo } from '@poe-sniper/shared';
import { apiGet, apiSend } from '../lib/api';
import { useEventStream } from './EventStreamProvider';

export interface AddSearchPayload {
  input: string;
  label?: string;
  league?: string;
  autoTravel?: boolean;
  purchaseMode?: PurchaseMode | null;
}

export interface UpdateSearchPayload {
  label?: string;
  autoTravel?: boolean;
  purchaseMode?: PurchaseMode | null;
}

/** Fetches the watched searches; refetches whenever SSE signals a change. */
export function useSearches() {
  const { searchesVersion } = useEventStream();
  const [searches, setSearches] = useState<SearchRuntimeInfo[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(() => {
    apiGet<SearchRuntimeInfo[]>('/api/searches')
      .then((rows) => {
        setSearches(rows);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, searchesVersion]);

  const add = useCallback(
    async (payload: AddSearchPayload) => {
      await apiSend<SearchRuntimeInfo>('POST', '/api/searches', payload);
      refresh();
    },
    [refresh],
  );

  const update = useCallback(
    async (searchId: string, payload: UpdateSearchPayload) => {
      await apiSend<SearchRuntimeInfo>('PATCH', `/api/searches/${searchId}`, payload);
      refresh();
    },
    [refresh],
  );

  const remove = useCallback(
    async (searchId: string) => {
      await apiSend<{ removed: true }>('DELETE', `/api/searches/${searchId}`);
      refresh();
    },
    [refresh],
  );

  return { searches, loaded, add, update, remove };
}
