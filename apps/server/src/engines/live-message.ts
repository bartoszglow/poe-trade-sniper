/**
 * Parses a trade2 live-websocket frame into the keys to pass to /fetch.
 *
 * PoE2 live feed (verified against GGG 2026-06): the connection first gets an
 * `{"auth":true}` ack, then one `{"result":"<jwt>"}` per new listing. The JWT
 * is an opaque, short-lived signed fetch token — the official client passes it
 * straight to `/api/trade2/fetch/<token>?query=<id>&realm=poe2` (GGG decodes the
 * encrypted payload server-side), so we do exactly the same: return the token.
 *
 * Legacy PoE1 shape `{"new":["id", …]}` is still accepted. Returns null for the
 * auth ack, keepalives, and anything else.
 */
export function parseLiveMessage(text: string): string[] | null {
  let payload: { new?: unknown; result?: unknown };
  try {
    payload = JSON.parse(text) as { new?: unknown; result?: unknown };
  } catch {
    return null;
  }
  if (typeof payload.result === 'string' && payload.result.length > 0) {
    return [payload.result];
  }
  if (Array.isArray(payload.new) && payload.new.length > 0) {
    return payload.new.filter((value): value is string => typeof value === 'string');
  }
  return null;
}

/**
 * Reconnect ladder lookup: fast first retry (a gap = missed listings),
 * backing off on consecutive failures (aggressive loops burn the IP budget).
 * Past the last rung the delay stays at the ladder's end.
 */
export function reconnectDelayFromLadder(ladderMs: number[], attemptIndex: number): number {
  return ladderMs[Math.min(attemptIndex, ladderMs.length - 1)] ?? 5_000;
}

/**
 * Close-code-aware delay: 1013 ("Try Again Later") is the server explicitly
 * rate-limiting our live sockets — back off for the dedicated (long) window
 * instead of retrying on the fast ladder, which would just sustain the 1013.
 * Poll coverage keeps detection alive during the wait.
 */
export function reconnectDelayForClose(
  closeCode: number,
  ladderMs: number[],
  attemptIndex: number,
  rateLimitBackoffMs: number,
): number {
  if (closeCode === 1013) {
    return rateLimitBackoffMs;
  }
  return reconnectDelayFromLadder(ladderMs, attemptIndex);
}
