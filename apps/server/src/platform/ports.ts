import type { PermissionKind, PermissionState } from '@poe-sniper/shared';

/**
 * Reads / requests OS permission state. Implemented natively only in the desktop
 * shell (Electron `systemPreferences`, macOS); the no-op default reports
 * `'unsupported'` everywhere else.
 */
export interface PermissionProbe {
  /** Live, non-blocking read (cheap enough to poll for revocation). */
  query(kind: PermissionKind): PermissionState;
  /** Trigger the OS prompt or deep-link to the Settings pane. */
  request(kind: PermissionKind): Promise<void>;
  /** Open the System Settings pane for this kind (manage / revoke). */
  openSettingsPane(kind: PermissionKind): void;
}

/**
 * The desktop-platform aggregate the shell injects into the server before
 * `app.listen()`. Grows in Phase 2 (capture / input / vision / user-input
 * watcher); the no-op default keeps the server cross-platform and testable.
 */
export interface DesktopPlatform {
  permissionProbe: PermissionProbe;
}
