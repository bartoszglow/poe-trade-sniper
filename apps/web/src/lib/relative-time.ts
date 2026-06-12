/**
 * Compact "time ago" magnitude (`12s`, `3m`, `2h`, `5d`) — locale-agnostic, so
 * the caller adds any "ago" suffix via i18n. `nowMs` is passed in (not read
 * from the clock) so render stays pure and a single ticking state drives all
 * relative timestamps on a page.
 */
export function formatRelativeMagnitude(iso: string, nowMs: number): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.round((nowMs - then) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
