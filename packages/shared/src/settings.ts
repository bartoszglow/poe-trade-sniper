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
}

export const CURSOR_MODES: readonly CursorMode[] = ['instant', 'smooth'];

export const DEFAULT_PRICE_CHECK_HOTKEY = 'CommandOrControl+Shift+D';

export const DEFAULT_APP_SETTINGS: AppSettings = {
  cursorMode: 'instant',
  priceCheckHotkey: DEFAULT_PRICE_CHECK_HOTKEY,
  priceCheckSinks: ['panel'],
};
