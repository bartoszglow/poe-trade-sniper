import { uIOhook } from 'uiohook-napi';

/**
 * Ref-counted uiohook lifecycle. Two owners share the ONE global keyboard/mouse
 * hook: the buy-abort user-input watcher (active only during a buy) and the
 * price-check hotkey listener (active whenever a hotkey is configured). The hook
 * starts on the first `acquire()` and stops on the last release, so one owner
 * tearing down never kills the other's events.
 */
let refs = 0;

export function acquireUiohook(): () => void {
  refs += 1;
  if (refs === 1) uIOhook.start();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    refs -= 1;
    if (refs === 0) uIOhook.stop();
  };
}
