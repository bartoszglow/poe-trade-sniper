import { uIOhook } from 'uiohook-napi';
import type { UserInputWatcher } from '@poe-sniper/server';
import { isWithinSyntheticGrace } from './synthetic-input-marker.js';

/**
 * Grace window (ms) shared with the server's BUY_SYNTHETIC_INPUT_GRACE_MS: mouse
 * moves within it are our own synthetic steps, not the user's. Read from the
 * same env var (falls back to the server default) so there is one source.
 */
const SYNTHETIC_GRACE_MS = Number(process.env['BUY_SYNTHETIC_INPUT_GRACE_MS'] ?? 120);

/**
 * Global input watcher (uiohook-napi). Keyboard / clicks / wheel abort
 * immediately (unambiguously the user); mouse MOVES abort only when outside the
 * synthetic-move grace window, so our own nut.js moves don't self-abort (the
 * O-7 mitigation). The OS hook runs only while a buy is actually listening.
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

  return {
    onRealInput(callback: () => void): () => void {
      listeners.add(callback);
      if (!started) {
        uIOhook.on('mousemove', onMove);
        uIOhook.on('keydown', fire);
        uIOhook.on('mousedown', fire);
        uIOhook.on('wheel', fire);
        uIOhook.start();
        started = true;
      }
      return () => {
        listeners.delete(callback);
        if (listeners.size === 0 && started) {
          uIOhook.off('mousemove', onMove);
          uIOhook.off('keydown', fire);
          uIOhook.off('mousedown', fire);
          uIOhook.off('wheel', fire);
          uIOhook.stop();
          started = false;
        }
      };
    },
  };
}
