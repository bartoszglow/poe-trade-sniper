import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  PurchaseMode,
  RoomDeleteMode,
  RoomInfo,
  SearchLayoutEntry,
  SearchRuntimeInfo,
  SearchesView,
} from '@poe-sniper/shared';
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
  /** Archive / restore (#35) — archived searches keep everything for a restore. */
  archived?: boolean;
}

/** Fetches the watched searches; refetches whenever SSE signals a change. */
export function useSearches() {
  const { searchesVersion } = useEventStream();
  // Debounce the SSE-driven refetch (engine-status bursts); user actions below
  // call refresh() directly, so add/edit/remove stay immediate.
  const debouncedVersion = useDebouncedValue(searchesVersion, REFETCH_DEBOUNCE_MS);
  const [searches, setSearches] = useState<SearchRuntimeInfo[]>([]);
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [layout, setLayout] = useState<SearchLayoutEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  // A refetch fires on every searches-changed/engine-status bump. Without
  // ordering, a slower earlier response can land after a newer one and clobber
  // it — e.g. the "poll" gap-cover response overwriting the fresh "ws" badge,
  // which then sticks until the next status change. Apply only the latest
  // request's response.
  const latestRequestId = useRef(0);

  const refresh = useCallback(() => {
    const requestId = (latestRequestId.current += 1);
    apiGet<SearchesView>('/api/searches')
      .then((view) => {
        if (requestId !== latestRequestId.current) return;
        setSearches(view.searches);
        setRooms(view.rooms);
        setLayout(view.layout);
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

  /** Commit a drag-and-drop result: top-level order + room membership in one call (#33). */
  const reorderLayout = useCallback(
    async (nextLayout: SearchLayoutEntry[]) => {
      await apiSend<SearchesView>('POST', '/api/searches/reorder', { layout: nextLayout });
      refresh();
    },
    [refresh],
  );

  /** Creates the room (appended at the end) and returns it, for follow-up UI (rename). */
  const createRoom = useCallback(
    async (name: string): Promise<RoomInfo | null> => {
      const view = await apiSend<SearchesView>('POST', '/api/rooms', { name });
      refresh();
      return view.rooms.at(-1) ?? null;
    },
    [refresh],
  );

  const updateRoom = useCallback(
    async (roomId: string, payload: { name?: string; collapsed?: boolean }) => {
      await apiSend<SearchesView>('PATCH', `/api/rooms/${roomId}`, payload);
      refresh();
    },
    [refresh],
  );

  /** The mode is the operator's D-room-2 choice — always explicit, never defaulted. */
  const removeRoom = useCallback(
    async (roomId: string, mode: RoomDeleteMode) => {
      await apiSend<SearchesView>('DELETE', `/api/rooms/${roomId}?mode=${mode}`);
      refresh();
    },
    [refresh],
  );

  /** Room master switch (D-room-1): sets `enabled` on every member at once. */
  const setRoomEnabled = useCallback(
    async (roomId: string, enabled: boolean) => {
      await apiSend<SearchesView>('POST', `/api/rooms/${roomId}/enabled`, { enabled });
      refresh();
    },
    [refresh],
  );

  return {
    searches,
    rooms,
    layout,
    loaded,
    add,
    update,
    remove,
    reorderLayout,
    createRoom,
    updateRoom,
    removeRoom,
    setRoomEnabled,
  };
}
