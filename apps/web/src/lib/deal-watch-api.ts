import type { DealBaselineHistoryEntry } from '@poe-sniper/shared';
import { apiGet } from './api';

/**
 * Typed client for the deal-watch endpoints (plan 41). The manual-refresh
 * endpoint answers its gates with structured JSON bodies — 429
 * `{code:'deal-refresh-cooldown', retryInMs}` and 409 `{code:'deal-refresh-…'}`
 * — which the generic ApiError (status + message only) cannot carry, so this
 * module parses them into a discriminated outcome the UI can render honestly.
 */

/** Why the server declined a manual refresh (409) — each maps to an i18n message. */
export type DealRefreshDeclinedCode = 'archived' | 'disabled' | 'paused' | 'guard-tripped';

const DECLINED_CODES: readonly DealRefreshDeclinedCode[] = [
  'archived',
  'disabled',
  'paused',
  'guard-tripped',
];

export type DealRefreshOutcome =
  | { kind: 'ok' }
  | { kind: 'cooldown'; retryInMs: number }
  | { kind: 'declined'; code: DealRefreshDeclinedCode }
  /** Anything else (network error, unknown body) — the UI shows the generic failure. */
  | { kind: 'failed' };

function isDeclinedCode(value: string): value is DealRefreshDeclinedCode {
  return (DECLINED_CODES as readonly string[]).includes(value);
}

/** Best-effort JSON body parse — a broken/empty body degrades to `failed`, never throws. */
async function readJsonBody(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await response.json();
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** POST /api/searches/:id/deal-refresh → a typed outcome (never throws). */
export async function requestDealRefresh(searchId: string): Promise<DealRefreshOutcome> {
  let response: Response;
  try {
    response = await fetch(`/api/searches/${searchId}/deal-refresh`, {
      method: 'POST',
      headers: { accept: 'application/json' },
    });
  } catch {
    return { kind: 'failed' };
  }
  if (response.ok) return { kind: 'ok' };
  const body = await readJsonBody(response);
  const code = typeof body?.['code'] === 'string' ? body['code'] : null;
  if (response.status === 429 && code === 'deal-refresh-cooldown') {
    const retryInMs = body?.['retryInMs'];
    if (typeof retryInMs === 'number' && Number.isFinite(retryInMs) && retryInMs >= 0) {
      return { kind: 'cooldown', retryInMs };
    }
  }
  if (response.status === 409 && code !== null && code.startsWith('deal-refresh-')) {
    const declinedCode = code.slice('deal-refresh-'.length);
    if (isDeclinedCode(declinedCode)) return { kind: 'declined', code: declinedCode };
  }
  return { kind: 'failed' };
}

/** GET /api/searches/:id/deal-history — newest-first baseline samples (D-dw-12). */
export function fetchDealHistory(
  searchId: string,
  limit: number,
): Promise<DealBaselineHistoryEntry[]> {
  return apiGet<DealBaselineHistoryEntry[]>(
    `/api/searches/${searchId}/deal-history?limit=${limit}`,
  );
}
