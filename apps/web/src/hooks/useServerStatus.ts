import { useCallback, useEffect, useState } from 'react';
import type { PermissionsStatus, SessionPublicStatus } from '@poe-sniper/shared';
import { apiGet } from '../lib/api';

interface RateLimitRule {
  maxHits: number;
  periodSeconds: number;
  restrictionSeconds: number;
}

interface RateLimitSnapshot {
  policyName: string | null;
  rules: RateLimitRule[];
  states: RateLimitRule[];
}

export interface ServerStatus {
  session: SessionPublicStatus;
  rateLimit: {
    pausedUntil: string | null;
    policies: Record<string, RateLimitSnapshot>;
  };
  searches: { total: number; byStatus: Record<string, number> };
  travel: {
    queueLength: number;
    lastTravel: { phase: string; itemName: string | null; at: string } | null;
  };
  guard: {
    tripped: boolean;
    reason: string | null;
    httpInLastMinute: number;
    wsConnectsInLastMinute: number;
  };
  permissions: PermissionsStatus;
  capabilities: { canCapture: boolean; canControl: boolean };
}

const POLL_INTERVAL_MS = 10_000;

/** Polls /api/status for the status bar + Settings; SSE covers the rest. */
export function useServerStatus(): { status: ServerStatus | null; refresh: () => void } {
  const [status, setStatus] = useState<ServerStatus | null>(null);

  const refresh = useCallback(() => {
    apiGet<ServerStatus>('/api/status')
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return { status, refresh };
}

/** "11/60" from the tightest bucket of the search policy, or null. */
export function formatSearchBudget(status: ServerStatus | null): string | null {
  const snapshot = status?.rateLimit.policies['search'];
  if (!snapshot || snapshot.rules.length === 0) return null;
  let tightest: { used: number; max: number; ratio: number } | null = null;
  for (let index = 0; index < snapshot.rules.length; index += 1) {
    const rule = snapshot.rules[index];
    const state = snapshot.states[index];
    if (!rule || !state || rule.maxHits === 0) continue;
    const ratio = state.maxHits / rule.maxHits;
    if (!tightest || ratio > tightest.ratio) {
      tightest = { used: state.maxHits, max: rule.maxHits, ratio };
    }
  }
  return tightest ? `${tightest.used}/${tightest.max}` : null;
}
