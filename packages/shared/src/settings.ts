/** How the buy automation moves the cursor onto the item to purchase. */
export type CursorMode = 'instant' | 'smooth';

/** Where a desktop price-check result appears (#37). */
export type PriceCheckSink = 'panel' | 'overlay';
export const PRICE_CHECK_SINK_OPTIONS: readonly PriceCheckSink[] = ['panel', 'overlay'];

/** User-tunable app settings (persisted server-side in app_state, key 'settings'). */
export interface AppSettings {
  /**
   * 'instant' — jump the cursor straight to the item (fast, the default).
   * 'smooth' — a human-like eased glide to the item.
   */
  cursorMode: CursorMode;
  /**
   * Global hotkey that triggers a price check (#37), as an Electron accelerator
   * string (e.g. 'CommandOrControl+Shift+D'). Configurable in Settings.
   */
  priceCheckHotkey: string;
  /**
   * Which result surfaces are ENABLED — a whitelist, not a single mode, so the
   * operator can run the in-app panel and the in-game overlay at the same time
   * (independent toggles). Empty = a price check runs but shows nowhere.
   */
  priceCheckSinks: PriceCheckSink[];
  /**
   * How many searches may run deal watch at once (plan 41, D-dw-17). The hourly
   * market query is cheap; the real constraint is concurrent GGG `/live`
   * sockets, whose tolerance is unprobed — a high value risks GGG rate-limiting
   * the live connections, though poll coverage still catches deals if a socket
   * is throttled. Bounded [DEAL_MAX_WATCHES_MIN, DEAL_MAX_WATCHES_MAX].
   */
  dealMaxWatches: number;
  /**
   * Target utilization as a % of GGG's ADVERTISED rate limits (plan 41,
   * D-dw-19). The governor learns the real limits live from `X-Rate-Limit-*`
   * headers and scales its effective ceiling by this factor. 100 = run right at
   * GGG's advertised cap; below leaves margin. **Above 100 (up to the MAX) is a
   * RISK ZONE** — it deliberately exceeds GGG's limits → 429s → the governor
   * pauses ALL outbound (lockouts stack) and it stops looking browser-like.
   * Bounded [RATE_LIMIT_AGGRESSIVENESS_MIN, RATE_LIMIT_AGGRESSIVENESS_MAX];
   * <= RATE_LIMIT_AGGRESSIVENESS_SAFE_MAX is the safe band.
   */
  rateLimitAggressiveness: number;
}

export const CURSOR_MODES: readonly CursorMode[] = ['instant', 'smooth'];

export const DEFAULT_PRICE_CHECK_HOTKEY = 'CommandOrControl+Shift+D';

/** Deal-watch concurrency bounds (D-dw-17) — the editable-setting range. */
export const DEAL_MAX_WATCHES_MIN = 1;
export const DEAL_MAX_WATCHES_MAX = 50;
export const DEFAULT_DEAL_MAX_WATCHES = 25;

/** Rate-limit aggressiveness bounds (D-dw-19) — % of GGG's advertised limits. */
export const RATE_LIMIT_AGGRESSIVENESS_MIN = 50;
export const RATE_LIMIT_AGGRESSIVENESS_MAX = 120;
/** Highest value that never intentionally exceeds GGG's limits — above this is the risk zone. */
export const RATE_LIMIT_AGGRESSIVENESS_SAFE_MAX = 100;
export const DEFAULT_RATE_LIMIT_AGGRESSIVENESS = 85;

/**
 * Fail-CLOSED clamp for the aggressiveness value at the point it drives the
 * governor / guard (D-dw-19, review S2). The API path is zod-bounded, but a
 * corrupt or legacy `app_state` settings row could persist a non-numeric or
 * out-of-range value — and that value scales the LOAD-BEARING rate-limit
 * ceilings. A bad value must never disarm the governor (NaN comparisons make
 * every near-limit hold and HTTP tripwire silently false); it falls back to the
 * safe default and clamps into the allowed band.
 */
export function clampAggressiveness(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_RATE_LIMIT_AGGRESSIVENESS;
  }
  return Math.min(RATE_LIMIT_AGGRESSIVENESS_MAX, Math.max(RATE_LIMIT_AGGRESSIVENESS_MIN, value));
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  cursorMode: 'instant',
  priceCheckHotkey: DEFAULT_PRICE_CHECK_HOTKEY,
  priceCheckSinks: ['panel'],
  dealMaxWatches: DEFAULT_DEAL_MAX_WATCHES,
  rateLimitAggressiveness: DEFAULT_RATE_LIMIT_AGGRESSIVENESS,
};
