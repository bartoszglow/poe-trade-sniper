import type { DesktopPlatform } from '@poe-sniper/server';
import { createElectronPermissionProbe } from './permission-probe.electron.js';

/**
 * Assembles the real desktop-platform aggregate the Electron shell injects into
 * the in-process server (preview/packaged) and reuses for the permission IPC.
 * Grows in Phase 2 (capture / input / vision / user-input watcher).
 */
export function createDesktopPlatform(): DesktopPlatform {
  return { permissionProbe: createElectronPermissionProbe() };
}
