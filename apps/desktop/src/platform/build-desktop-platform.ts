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
  // Sanitized for the osascript focus call; the server validates the same var via Zod.
  const gameProcessName = (process.env['GAME_FOCUS_PROCESS'] ?? 'wine').replace(
    /[^A-Za-z0-9 ._-]/g,
    '',
  );
  return {
    permissionProbe,
    captureSource: createElectronCaptureSource(permissionProbe, gameProcessName),
    tradeVision: createRawPixelTradeVision(),
    inputController: createNutInputController(permissionProbe),
    userInputWatcher: createUiohookUserInputWatcher(),
  };
}
