import type { PermissionKind, PermissionState, PermissionsStatus } from '@poe-sniper/shared';
import type { PermissionProbe } from './ports.js';

/**
 * A permission probe whose status is PUSHED in — used by the standalone dev
 * server only. That server runs in plain Node, so it can't call macOS
 * `systemPreferences`; instead the Electron main (which holds the real probe)
 * pushes live TCC status to it via `POST /api/dev/permissions`. This makes the
 * capability gate + `/api/status` behave IDENTICALLY in `pnpm dev` and in the
 * packaged app (dev↔prod parity) without an ABI swap, and it keeps the renderer
 * on the single HTTP source of truth (decision #10).
 *
 * Defaults to `unsupported` (matches the no-op default) until the first push;
 * `request`/`openSettingsPane` are no-ops here — the renderer drives those over
 * IPC straight to the main process's real probe.
 */
export class PushedPermissionProbe implements PermissionProbe {
  // Object literal (not derived from PERMISSION_KINDS) so a new shared kind fails
  // typecheck here until handled — exhaustive by construction.
  private status: PermissionsStatus = {
    screenRecording: 'unsupported',
    accessibility: 'unsupported',
  };

  query(kind: PermissionKind): PermissionState {
    return this.status[kind];
  }

  set(status: PermissionsStatus): void {
    this.status = status;
  }

  request(): Promise<void> {
    return Promise.resolve();
  }

  openSettingsPane(): void {}
}
