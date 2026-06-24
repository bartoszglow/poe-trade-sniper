import type { DesktopPlatform } from '@poe-sniper/server';
import { createElectronCaptureSource } from './capture-source.electron.js';
import { createElectronPermissionProbe } from './permission-probe.electron.js';
import { createNutInputController } from './input-controller.nut.js';
import { createRawPixelTradeVision } from './trade-vision.adapter.js';
import { createUiohookUserInputWatcher } from './user-input-watcher.uiohook.js';

/**
 * Assembles the real desktop-platform aggregate the Electron shell injects into
 * the in-process server (preview/packaged) and reuses for the permission IPC.
 * Native deps (nut.js / uiohook-napi / Electron `desktopCapturer`) live ONLY
 * behind these adapters — the server depends solely on the port interfaces.
 */
export function createDesktopPlatform(): DesktopPlatform {
  const permissionProbe = createElectronPermissionProbe();
  // The game WINDOW TITLE (not process name): under Wine the process is just
  // "wine" and there are two of them, so we focus by window title. Sanitized for
  // the osascript call; the server validates the same var via Zod.
  const gameWindowTitle = (process.env['GAME_WINDOW_TITLE'] ?? 'Path of Exile 2').replace(
    /[^A-Za-z0-9 ._-]/g,
    '',
  );
  // Delay (ms) inside the focus osascript so the macOS Space-switch settles
  // before the window bounds are read; tunable via env, default 250.
  const parsedSettle = Number(process.env['BUY_FOCUS_SETTLE_MS']);
  const focusSettleMs = Number.isFinite(parsedSettle) && parsedSettle >= 0 ? parsedSettle : 250;
  return {
    permissionProbe,
    captureSource: createElectronCaptureSource(permissionProbe, gameWindowTitle, focusSettleMs),
    tradeVision: createRawPixelTradeVision(),
    inputController: createNutInputController(permissionProbe),
    userInputWatcher: createUiohookUserInputWatcher(),
  };
}
