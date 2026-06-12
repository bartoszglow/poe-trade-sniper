import { useEffect, useState } from 'react';
import type { UpdateStatus } from '@poe-sniper/shared';
import { apiGet } from '../lib/api';

/** Re-check periodically so a long-running app notices a release we publish. */
const RECHECK_INTERVAL_MS = 3_600_000;

/** Polls `GET /api/update`; null until the first result. Dormant when unconfigured. */
export function useUpdateCheck(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    const run = () => {
      apiGet<UpdateStatus>('/api/update')
        .then(setStatus)
        .catch(() => undefined);
    };
    run();
    const timer = setInterval(run, RECHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return status;
}
