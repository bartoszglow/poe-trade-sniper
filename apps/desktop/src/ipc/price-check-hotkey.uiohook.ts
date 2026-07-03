import { uIOhook, UiohookKey } from 'uiohook-napi';
import { acquireUiohook } from '../platform/uiohook-lifecycle.js';
import {
  matchesModifiers,
  parseHotkey,
  type HotkeyEvent,
  type ParsedHotkey,
} from '../platform/hotkey-matcher.js';

export interface PriceCheckHotkeyListener {
  /** Set (or clear) the active hotkey from its accelerator string. */
  setHotkey(accelerator: string | null): void;
  dispose(): void;
}

/**
 * Price-check hotkey via a uiohook GLOBAL OBSERVER (not an Electron globalShortcut).
 *
 * Why: globalShortcut CAPTURES the accelerator system-wide, so it clashes with the
 * operator's shortcuts in other apps even when the game isn't focused. uiohook only
 * OBSERVES keydowns (never suppresses them), so we can match the combo, gate on the
 * game window being frontmost, and act ONLY in-game — the key passes through to every
 * app otherwise. This also lets a bare single key be a hotkey safely (it isn't eaten
 * globally). Needs the Accessibility permission (already required for buy-automation)
 * and on-Mac + in-game validation (game-focus gate under Wine).
 */
export function createPriceCheckHotkeyListener(options: {
  isMac: boolean;
  /** Whether the game window is currently frontmost — the gate. */
  isGameFocused: () => Promise<boolean>;
  onTrigger: () => void;
}): PriceCheckHotkeyListener {
  let parsed: ParsedHotkey | null = null;
  let keycode: number | null = null;
  let release: (() => void) | null = null;
  let gateInFlight = false;

  function onKeydown(event: unknown): void {
    const keyEvent = event as HotkeyEvent;
    if (parsed === null || keycode === null) return;
    if (keyEvent.keycode !== keycode || !matchesModifiers(parsed, keyEvent)) return;
    // Match — now gate on the game being frontmost, then trigger. The gate is async
    // (a foreground-window probe); ignore repeats (OS key-repeat) while it resolves.
    if (gateInFlight) return;
    gateInFlight = true;
    options
      .isGameFocused()
      .then((focused) => {
        if (focused) options.onTrigger();
      })
      .catch(() => {
        /* a failed focus probe simply doesn't fire — never throw out of the hook */
      })
      .finally(() => {
        gateInFlight = false;
      });
  }

  function attach(): void {
    if (release) return;
    release = acquireUiohook();
    uIOhook.on('keydown', onKeydown);
  }
  function detach(): void {
    if (!release) return;
    uIOhook.off('keydown', onKeydown);
    release();
    release = null;
  }

  return {
    setHotkey(accelerator: string | null): void {
      parsed = accelerator ? parseHotkey(accelerator, options.isMac) : null;
      keycode =
        parsed !== null ? ((UiohookKey as Record<string, number>)[parsed.keyName] ?? null) : null;
      // Only run the global hook while a resolvable hotkey is set.
      if (parsed !== null && keycode !== null) attach();
      else detach();
    },
    dispose(): void {
      detach();
    },
  };
}
