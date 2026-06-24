import { ipcMain } from 'electron';
import type { PermissionKind, PermissionProbe } from '@poe-sniper/server';

/**
 * Validate the renderer-supplied kind (the only untrusted IPC payload). If a new
 * PermissionKind is added in shared, extend this guard too — kept narrow on
 * purpose so the main process never acts on an unknown string.
 */
function isPermissionKind(value: unknown): value is PermissionKind {
  return value === 'screenRecording' || value === 'accessibility';
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
