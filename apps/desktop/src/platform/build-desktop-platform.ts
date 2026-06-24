import type { DesktopPlatform } from '@poe-sniper/server';
import { createElectronPermissionProbe } from './permission-probe.electron.js';

/**
 * Assembles the real desktop-platform aggregate the Electron shell injects into
 * the in-process server (preview/packaged) and reuses for the permission IPC.
 *
 * The Phase-2 capture / vision / input / watcher ports are inert here until P2.6
 * wires the native adapters (`desktopCapturer` / OpenCV-wasm / `nut.js` /
 * `uiohook-napi`). While inert, BuyAutomationService finds no window and no-ops.
 */
export function createDesktopPlatform(): DesktopPlatform {
  return {
    permissionProbe: createElectronPermissionProbe(),
    captureSource: {
      capture: () => Promise.resolve({ width: 0, height: 0, pixels: new Uint8Array(0) }),
      focusGameWindow: () => Promise.resolve(false),
      isGameWindowFocused: () => Promise.resolve(false),
    },
    tradeVision: {
      detectTradeWindow: () => Promise.resolve(null),
      locateItem: () => Promise.resolve(null),
    },
    inputController: {
      moveHumanLike: () => Promise.resolve(),
    },
    userInputWatcher: {
      onRealInput: () => () => {},
    },
  };
}
