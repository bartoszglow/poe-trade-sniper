/**
 * Parses a trade2 live-websocket frame. Observed shape: `{"new": ["id", …]}`
 * (api-notes "Endpoints"). Returns null for keepalives/anything else.
 */
export function parseLiveMessage(text: string): string[] | null {
  let payload: { new?: unknown };
  try {
    payload = JSON.parse(text) as { new?: unknown };
  } catch {
    return null;
  }
  if (!Array.isArray(payload.new) || payload.new.length === 0) return null;
  return payload.new.filter((value): value is string => typeof value === 'string');
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
 * asking for backoff — jump straight to the ladder's top rung instead of
 * climbing through the fast ones.
 */
export function reconnectDelayForClose(
  closeCode: number,
  ladderMs: number[],
  attemptIndex: number,
): number {
  if (closeCode === 1013) {
    return ladderMs[ladderMs.length - 1] ?? 60_000;
  }
  return reconnectDelayFromLadder(ladderMs, attemptIndex);
}
