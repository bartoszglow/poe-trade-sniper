import { BrowserWindow, clipboard } from 'electron';
import type { DesktopPlatform } from '@poe-sniper/server';
import { createPriceCheckOverlay } from '../overlay/price-check-overlay.js';
import { createPriceCheckHotkeyListener } from './price-check-hotkey.uiohook.js';

/**
 * Desktop price-check hotkey bridge (#37, phase B).
 *
 * On the configured hotkey — matched by a game-focus-gated uiohook OBSERVER, so it
 * fires ONLY while the game window is frontmost and never clashes with the operator's
 * shortcuts in other apps (see price-check-hotkey.uiohook.ts): synthesize the copy
 * chord so the game copies the hovered item (best-effort — a shell without native
 * input skips it and uses whatever is already on the clipboard), read the item text,
 * POST it ONCE to the loopback `/api/price-check`, then distribute the single result
 * to the enabled sinks — the in-app panel (main window) and/or the click-through
 * overlay. POSTing once matters: a rare-item check spends SEARCH budget, so we
 * never double-spend it across sinks.
 *
 * NEEDS on-Mac + in-game validation (synthetic copy + clipboard sync under
 * Wine, overlay over the game) — the same hardware gap as the buy-automation
 * native input. The structure/wiring is complete and unit-independent.
 */

/** How long to wait for the game→clipboard copy to land (Wine sync ~2 s). */
const CLIPBOARD_WAIT_MS = 2500;
const CLIPBOARD_POLL_MS = 100;

interface PriceCheckSettings {
  priceCheckHotkey: string;
  priceCheckSinks: Array<'panel' | 'overlay'>;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchSettings(apiBaseUrl: string): Promise<PriceCheckSettings | null> {
  try {
    const response = await fetch(`${apiBaseUrl}/api/settings`, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return null;
    return (await response.json()) as PriceCheckSettings;
  } catch {
    return null;
  }
}

/**
 * Copy the hovered item, then wait for NEW text to appear on the clipboard.
 * Compares against the pre-copy text so a failed copy doesn't re-price the
 * last item. Returns the item text, or null if nothing new landed.
 */
async function captureItemText(platform: DesktopPlatform): Promise<string | null> {
  const before = clipboard.readText();
  try {
    await platform.inputController.copySelection?.();
  } catch {
    // No native input (or permission denied) — fall back to current clipboard.
  }
  const deadline = Date.now() + CLIPBOARD_WAIT_MS;
  while (Date.now() < deadline) {
    const current = clipboard.readText();
    if (current && current !== before) return current;
    await sleep(CLIPBOARD_POLL_MS);
  }
  // No change: if the operator pre-copied the item themselves, use that.
  const current = clipboard.readText();
  return current && current === before ? current : null;
}

async function runPriceCheck(apiBaseUrl: string, itemText: string): Promise<unknown> {
  try {
    const response = await fetch(`${apiBaseUrl}/api/price-check`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ itemText }),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/** How often the bridge re-reads settings so a hotkey change rebinds live. */
const SETTINGS_POLL_MS = 5_000;

export interface PriceCheckBridge {
  dispose: () => void;
}

/**
 * Wire the price-check hotkey. `getMainWindow` supplies the current app window
 * (for the panel sink); `apiBaseUrl` is the loopback origin the server listens
 * on (dev: the standalone server; packaged: the in-process one).
 */
export function registerPriceCheckIpc(options: {
  platform: DesktopPlatform;
  getMainWindow: () => BrowserWindow | null;
  apiBaseUrl: string;
}): PriceCheckBridge {
  let overlay: ReturnType<typeof createPriceCheckOverlay> | null = null;
  let inFlight = false;

  async function onTrigger(): Promise<void> {
    // Re-entrancy guard: mashing the hotkey must not fire N concurrent checks
    // (each would spend real SEARCH budget). Ignore triggers until this resolves.
    if (inFlight) return;
    inFlight = true;
    try {
      await runOnce();
    } finally {
      inFlight = false;
    }
  }

  async function runOnce(): Promise<void> {
    const settings = await fetchSettings(options.apiBaseUrl);
    const sinks = settings?.priceCheckSinks ?? ['panel'];
    if (sinks.length === 0) return;
    const itemText = await captureItemText(options.platform);
    if (!itemText) return;
    const result = await runPriceCheck(options.apiBaseUrl, itemText);
    if (!result) return;
    if (sinks.includes('panel')) {
      options.getMainWindow()?.webContents.send('price-check:result', result);
    }
    if (sinks.includes('overlay')) {
      overlay ??= createPriceCheckOverlay();
      overlay.show(result);
    }
  }

  // The hotkey is a game-focus-gated global OBSERVER (uiohook), not an Electron
  // globalShortcut — so it never clashes with the operator's other-app shortcuts and
  // a bare single key is safe (never captured system-wide). It fires only while the
  // game window is frontmost.
  const hotkeyListener = createPriceCheckHotkeyListener({
    isMac: process.platform === 'darwin',
    isGameFocused: () => options.platform.captureSource.isGameWindowFocused(),
    onTrigger: () => void onTrigger(),
  });

  async function refresh(): Promise<void> {
    const settings = await fetchSettings(options.apiBaseUrl);
    hotkeyListener.setHotkey(settings?.priceCheckHotkey?.trim() || null);
  }

  // Own the settings poll here so it's cleared on dispose (no leaked interval).
  void refresh();
  const pollTimer = setInterval(() => void refresh(), SETTINGS_POLL_MS);

  function dispose(): void {
    clearInterval(pollTimer);
    hotkeyListener.dispose();
    overlay?.destroy();
    overlay = null;
  }

  return { dispose };
}
