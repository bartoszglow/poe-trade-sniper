import { useEffect, useState } from 'react';
import { apiGet } from '../lib/api';

interface HealthResponse {
  status: 'ok';
  version: string;
  dbMigrated: boolean;
}

export interface HealthState {
  healthy: boolean | null;
  version: string | null;
}

const POLL_INTERVAL_MS = 10_000;

/**
 * Polls /api/health for the shell's connection indicators. Replaced by the
 * SSE stream's connection state in Phase 3; polling stays as the fallback.
 */
export function useHealth(): HealthState {
  const [healthState, setHealthState] = useState<HealthState>({ healthy: null, version: null });

  useEffect(() => {
    let disposed = false;

    async function probe(): Promise<void> {
      try {
        const health = await apiGet<HealthResponse>('/api/health');
        if (!disposed) {
          setHealthState({ healthy: health.status === 'ok', version: health.version });
        }
      } catch {
        if (!disposed) {
          setHealthState((previous) => ({ healthy: false, version: previous.version }));
        }
      }
    }

    void probe();
    const timer = setInterval(() => void probe(), POLL_INTERVAL_MS);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);

  return healthState;
}
