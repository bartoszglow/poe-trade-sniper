import type { DesktopPermissionsApi } from '@poe-sniper/shared';

declare global {
  interface Window {
    /**
     * Exposed by the Electron preload (contextBridge). Absent in the web build —
     * always feature-detect (`window.desktopPermissions?.…`).
     */
    desktopPermissions?: DesktopPermissionsApi;
    /** Preload-exposed OS hint (avoids the deprecated navigator.platform). */
    systemInfo?: { platform: string };
  }
}

export {};
