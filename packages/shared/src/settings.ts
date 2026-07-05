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
}

export const CURSOR_MODES: readonly CursorMode[] = ['instant', 'smooth'];

export const DEFAULT_PRICE_CHECK_HOTKEY = 'CommandOrControl+Shift+D';

/** Deal-watch concurrency bounds (D-dw-17) — the editable-setting range. */
export const DEAL_MAX_WATCHES_MIN = 1;
export const DEAL_MAX_WATCHES_MAX = 50;
export const DEFAULT_DEAL_MAX_WATCHES = 25;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  cursorMode: 'instant',
  priceCheckHotkey: DEFAULT_PRICE_CHECK_HOTKEY,
  priceCheckSinks: ['panel'],
  dealMaxWatches: DEFAULT_DEAL_MAX_WATCHES,
};
