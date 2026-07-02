/**
 * Click-to-locate spotlight (#34 follow-up): clicking a live hit's search chip
 * highlights the source search on the Searches view — same gold glow and the
 * same 60s expiry as the fresh-hit highlight, and it reuses the room
 * auto-expand machinery so a collapsed room opens to reveal the row.
 *
 * ONE slot by design: spotlighting a second hit replaces the first (the
 * operator asked "which search was THIS one from" — plural answers are noise).
 * Session-scoped module state (like the room suppression store): survives
 * route changes — the click usually happens on ANOTHER page and navigates to
 * Searches — and dies on reload.
 */

/** Row-highlight duration — shared by the fresh-hit glow and the spotlight. */
export const SEARCH_HIGHLIGHT_MS = 60_000;

export interface SearchSpotlight {
  searchId: string;
  /** Epoch ms of the click — the 60s expiry runs from here. */
  at: number;
}

const CHANGE_EVENT = 'sniper:search-spotlight-changed';

let currentSpotlight: SearchSpotlight | null = null;

/** window is absent under the node test runner — the store still works there. */
function notifyChange(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function spotlightSearch(searchId: string, atMs: number = Date.now()): void {
  currentSpotlight = { searchId, at: atMs };
  notifyChange();
}

/** Dismiss early — e.g. the operator manually collapses the spotlit room. */
export function clearSearchSpotlight(): void {
  if (currentSpotlight === null) return;
  currentSpotlight = null;
  notifyChange();
}

export function readSearchSpotlight(): SearchSpotlight | null {
  return currentSpotlight;
}

export function isSpotlightFresh(spotlight: SearchSpotlight, nowMs: number): boolean {
  return nowMs - spotlight.at < SEARCH_HIGHLIGHT_MS;
}

export function subscribeSearchSpotlight(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}
