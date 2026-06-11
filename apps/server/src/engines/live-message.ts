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

/** Exponential backoff with a ceiling — aggressive reconnects burn the IP budget. */
export function nextReconnectDelayMs(currentMs: number, maxMs: number): number {
  return Math.min(currentMs * 2, maxMs);
}
