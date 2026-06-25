import { uIOhook } from 'uiohook-napi';
import type { UserInputWatcher } from '@poe-sniper/server';
import { isWithinSyntheticGrace, isWithinSyntheticKeyGrace } from './synthetic-input-marker.js';

/**
 * Grace window (ms) shared with the server's BUY_SYNTHETIC_INPUT_GRACE_MS: mouse
 * moves within it are our own synthetic steps, not the user's. Read from the
 * same env var (falls back to the server default) so there is one source.
 */
// Mirrors the server's BUY_SYNTHETIC_INPUT_GRACE_MS default. The desktop main
// can't import the server's validated config (it would pull @poe-sniper/server
// into the packaged main), so the default is duplicated here — defensively parsed
// so an empty/non-numeric env doesn't collapse the grace to 0 and self-abort every
// move on step one (DESK-3).
const DEFAULT_SYNTHETIC_GRACE_MS = 120;
const parsedGrace = Number(process.env['BUY_SYNTHETIC_INPUT_GRACE_MS']);
const SYNTHETIC_GRACE_MS =
  Number.isFinite(parsedGrace) && parsedGrace > 0 ? parsedGrace : DEFAULT_SYNTHETIC_GRACE_MS;

/**
 * Global input watcher (uiohook-napi). Clicks / wheel abort immediately
 * (unambiguously the user); mouse MOVES and KEYDOWNS abort only when outside their
 * synthetic-grace window, so our own nut.js moves AND keystrokes (Esc, Enter, the
 * `/hideout` chat command) don't self-abort (the O-7 mitigation). The OS hook runs
 * only while a buy is actually listening.
 */
export function createUiohookUserInputWatcher(): UserInputWatcher {
  const listeners = new Set<() => void>();
  let started = false;

  const fire = (): void => {
    for (const listener of listeners) listener();
  };
  const onMove = (): void => {
    if (!isWithinSyntheticGrace(SYNTHETIC_GRACE_MS)) fire();
  };
  const onKey = (): void => {
    if (!isWithinSyntheticKeyGrace(SYNTHETIC_GRACE_MS)) fire();
  };

  return {
    onRealInput(callback: () => void): () => void {
      listeners.add(callback);
      if (!started) {
        uIOhook.on('mousemove', onMove);
        uIOhook.on('keydown', onKey);
        uIOhook.on('mousedown', fire);
        uIOhook.on('wheel', fire);
        uIOhook.start();
        started = true;
      }
      return () => {
        listeners.delete(callback);
        if (listeners.size === 0 && started) {
          uIOhook.off('mousemove', onMove);
          uIOhook.off('keydown', onKey);
          uIOhook.off('mousedown', fire);
          uIOhook.off('wheel', fire);
          uIOhook.stop();
          started = false;
        }
      };
    },
  };
}
