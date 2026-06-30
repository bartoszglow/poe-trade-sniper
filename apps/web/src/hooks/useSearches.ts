import { useCallback, useEffect, useRef, useState } from 'react';
import type { PurchaseMode, SearchRuntimeInfo } from '@poe-sniper/shared';
import { apiGet, apiSend } from '../lib/api';
import { useDebouncedValue } from './useDebouncedValue';
import { useEventStream } from './EventStreamProvider';

/** Coalesce engine-status SSE bursts (GGG socket churn) into one refetch. */
const REFETCH_DEBOUNCE_MS = 300;

export interface AddSearchPayload {
  input: string;
  label?: string;
  league?: string;
  autoTravel?: boolean;
  autoBuy?: boolean;
  purchaseMode?: PurchaseMode | null;
}

export interface UpdateSearchPayload {
  label?: string;
  /** Re-point the row at a different trade search (bare id or URL); hits stay. */
  input?: string;
  autoTravel?: boolean;
  autoBuy?: boolean;
  purchaseMode?: PurchaseMode | null;
  enabled?: boolean;
}

/** Fetches the watched searches; refetches whenever SSE signals a change. */
export function useSearches() {
  const { searchesVersion } = useEventStream();
  // Debounce the SSE-driven refetch (engine-status bursts); user actions below
  // call refresh() directly, so add/edit/remove stay immediate.
  const debouncedVersion = useDebouncedValue(searchesVersion, REFETCH_DEBOUNCE_MS);
  const [searches, setSearches] = useState<SearchRuntimeInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  // A refetch fires on every searches-changed/engine-status bump. Without
  // ordering, a slower earlier response can land after a newer one and clobber
  // it — e.g. the "poll" gap-cover response overwriting the fresh "ws" badge,
  // which then sticks until the next status change. Apply only the latest
  // request's response.
  const latestRequestId = useRef(0);

  const refresh = useCallback(() => {
    const requestId = (latestRequestId.current += 1);
    apiGet<SearchRuntimeInfo[]>('/api/searches')
      .then((rows) => {
        if (requestId !== latestRequestId.current) return;
        setSearches(rows);
        setLoaded(true);
      })
      .catch(() => {
        if (requestId === latestRequestId.current) setLoaded(true);
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, debouncedVersion]);

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

  const reorder = useCallback(
    async (order: string[]) => {
      await apiSend<SearchRuntimeInfo[]>('POST', '/api/searches/reorder', { order });
      refresh();
    },
    [refresh],
  );

  return { searches, loaded, add, update, remove, reorder };
}
