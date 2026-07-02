/**
 * Live Hits panel layout preferences (#34): user-resizable width and a
 * hide/show toggle. Per-device UI state → localStorage (`sniper.*`), with a
 * custom event keeping the AppBar toggle, the shell grid and the panel header
 * in sync live (same pattern as useNetworkView).
 */

/** Today's default — matches the previous hardcoded 33rem column. */
export const HITS_PANEL_DEFAULT_WIDTH_PX = 528;
export const HITS_PANEL_MIN_WIDTH_PX = 320;
export const HITS_PANEL_MAX_WIDTH_PX = 720;
/** The middle content keeps at least this much of the viewport. */
export const HITS_PANEL_MAX_VIEWPORT_FRACTION = 0.45;
/** Arrow-key resize step on the focused divider. */
export const HITS_PANEL_KEYBOARD_STEP_PX = 16;

const WIDTH_STORAGE_KEY = 'sniper.hitsPanelWidth';
/** ISO timestamp of when the panel was hidden; absent = visible. Doubles as
 *  the reference for the "new hit while hidden" dot on the AppBar toggle. */
const HIDDEN_AT_STORAGE_KEY = 'sniper.hitsPanelHiddenAt';
const CHANGE_EVENT = 'sniper:hits-panel-layout-changed';

export interface HitsPanelLayout {
  widthPx: number;
  /** ISO-8601 hide time, or null while the panel is visible. */
  hiddenAt: string | null;
}

/** Clamp a requested width to the allowed band, capped by the viewport. */
export function clampHitsPanelWidth(widthPx: number, viewportWidthPx: number): number {
  const viewportCap = Math.floor(viewportWidthPx * HITS_PANEL_MAX_VIEWPORT_FRACTION);
  const maxWidth = Math.max(
    HITS_PANEL_MIN_WIDTH_PX,
    Math.min(HITS_PANEL_MAX_WIDTH_PX, viewportCap),
  );
  return Math.min(Math.max(Math.round(widthPx), HITS_PANEL_MIN_WIDTH_PX), maxWidth);
}

export function readHitsPanelLayout(): HitsPanelLayout {
  const storedWidth = Number(localStorage.getItem(WIDTH_STORAGE_KEY));
  const widthPx =
    Number.isFinite(storedWidth) && storedWidth > 0
      ? clampHitsPanelWidth(storedWidth, window.innerWidth)
      : HITS_PANEL_DEFAULT_WIDTH_PX;
  return { widthPx, hiddenAt: localStorage.getItem(HIDDEN_AT_STORAGE_KEY) };
}

export function storeHitsPanelWidth(widthPx: number): void {
  localStorage.setItem(WIDTH_STORAGE_KEY, String(clampHitsPanelWidth(widthPx, window.innerWidth)));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function resetHitsPanelWidth(): void {
  localStorage.removeItem(WIDTH_STORAGE_KEY);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function storeHitsPanelHidden(hidden: boolean): void {
  if (hidden) {
    localStorage.setItem(HIDDEN_AT_STORAGE_KEY, new Date().toISOString());
  } else {
    localStorage.removeItem(HIDDEN_AT_STORAGE_KEY);
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeHitsPanelLayout(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}
