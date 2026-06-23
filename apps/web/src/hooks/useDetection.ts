import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiSend } from '../lib/api';
import { useEventStream } from './EventStreamProvider';

/**
 * Global detection pause — the Searches-view master toggle. Refetches on the
 * same SSE bump the searches list uses, so it stays in sync (e.g. across the
 * web tab and the desktop window) without its own polling.
 */
export function useDetection() {
  const { searchesVersion } = useEventStream();
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    apiGet<{ paused: boolean }>('/api/detection')
      .then((result) => setPaused(result.paused))
      .catch(() => {});
  }, [searchesVersion]);

  const setDetectionPaused = useCallback(async (next: boolean) => {
    const result = await apiSend<{ paused: boolean }>('POST', '/api/detection', { paused: next });
    setPaused(result.paused);
  }, []);

  return { paused, setDetectionPaused };
}
