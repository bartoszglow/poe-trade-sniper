/** How the buy automation moves the cursor onto the item to purchase. */
export type CursorMode = 'instant' | 'smooth';

/** User-tunable app settings (persisted server-side in app_state, key 'settings'). */
export interface AppSettings {
  /**
   * 'instant' — jump the cursor straight to the item (fast, the default).
   * 'smooth' — a human-like eased glide to the item.
   */
  cursorMode: CursorMode;
}

export const CURSOR_MODES: readonly CursorMode[] = ['instant', 'smooth'];

export const DEFAULT_APP_SETTINGS: AppSettings = { cursorMode: 'instant' };
