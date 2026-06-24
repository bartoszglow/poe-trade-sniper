import { ipcMain } from 'electron';
import type { PermissionKind, PermissionProbe } from '@poe-sniper/server';

/**
 * Local kind allow-list. A *value* import of `PERMISSION_KINDS` from
 * `@poe-sniper/server` would drag the workspace server into the packaged main
 * (which loads the esbuild bundle, not the package) — so we keep a copy.
 * `satisfies` makes a typo or a removed kind fail typecheck.
 */
const KNOWN_KINDS = [
  'screenRecording',
  'accessibility',
] as const satisfies readonly PermissionKind[];

/** Validate the renderer-supplied kind (the only untrusted IPC payload). */
function isPermissionKind(value: unknown): value is PermissionKind {
  return (KNOWN_KINDS as readonly string[]).includes(value as string);
}

/**
 * Wires the two acts HTTP can't do: prompt for a permission, and open its
 * System Settings pane. Both are fire-and-forget (`on`, not `handle`) — live
 * status flows only over `/api/status`, so the IPC has no return value to
 * become a second source of truth. Register once, after `app.whenReady()`.
 */
export function registerPermissionsIpc(probe: PermissionProbe): void {
  ipcMain.on('permissions:request', (_event, kind: unknown) => {
    if (isPermissionKind(kind)) void probe.request(kind);
  });
  ipcMain.on('permissions:open-pane', (_event, kind: unknown) => {
    if (isPermissionKind(kind)) probe.openSettingsPane(kind);
  });
}
