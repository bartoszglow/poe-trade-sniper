import { useCallback, useEffect, useState } from 'react';
import { apiGet, apiSend } from '../lib/api';
import { useDebouncedValue } from './useDebouncedValue';
import { useEventStream } from './EventStreamProvider';

/** Coalesce engine-status SSE bursts (GGG socket churn) into one refetch. */
const REFETCH_DEBOUNCE_MS = 300;

/**
 * Global detection pause — the Searches-view master toggle. Refetches on the
 * same SSE bump the searches list uses, so it stays in sync (e.g. across the
 * web tab and the desktop window) without its own polling. The bump is
 * debounced so an engine-status burst doesn't restorm this endpoint.
 */
export function useDetection() {
  const { searchesVersion } = useEventStream();
  const debouncedVersion = useDebouncedValue(searchesVersion, REFETCH_DEBOUNCE_MS);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    apiGet<{ paused: boolean }>('/api/detection')
      .then((result) => setPaused(result.paused))
      .catch(() => {});
  }, [debouncedVersion]);

  const setDetectionPaused = useCallback(async (next: boolean) => {
    const result = await apiSend<{ paused: boolean }>('POST', '/api/detection', { paused: next });
    setPaused(result.paused);
  }, []);

  return { paused, setDetectionPaused };
}
