import type { TradeSearchRef } from '../trade-api/trade-api.client.js';

/**
 * Accepts a bare search id ("3ZPmDyGs5") or any trade2 URL — page
 * (/trade2/search/<realm>/<league>/<id>[/live]) or websocket
 * (/api/trade2/live/<realm>/<league>/<id>).
 */
export function parseSearchInput(input: string, defaultLeague: string): TradeSearchRef {
  const trimmed = input.trim();
  if (/^(https?|wss?):\/\//.test(trimmed)) {
    return parseTradeSearchUrl(trimmed);
  }
  if (!/^[A-Za-z0-9]{4,20}$/.test(trimmed)) {
    throw new Error(`"${trimmed}" does not look like a search id or trade URL`);
  }
  return { realm: 'poe2', league: defaultLeague, searchId: trimmed };
}

export function parseTradeSearchUrl(url: string): TradeSearchRef {
  const segments = new URL(url).pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (
    segments[0] === 'api' &&
    segments[1] === 'trade2' &&
    segments[2] === 'live' &&
    segments.length >= 6
  ) {
    return { realm: segments[3]!, league: segments[4]!, searchId: segments[5]! };
  }
  if (segments[0] === 'trade2' && segments[1] === 'search' && segments.length >= 5) {
    return { realm: segments[2]!, league: segments[3]!, searchId: segments[4]! };
  }
  throw new Error(`Unrecognized trade search URL: ${url}`);
}

/** The query's effective status.option (used to gate auto-travel on securable). */
export function queryStatusOption(query: unknown): string | null {
  const status = (query as { status?: { option?: unknown } } | null)?.status;
  return typeof status?.option === 'string' ? status.option : null;
}
