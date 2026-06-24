import type { PermissionKind, PermissionProbe } from '@poe-sniper/server';

/**
 * Adapter self-gate (decision #3): refuse at the resource boundary when a
 * required macOS grant is missing — defence-in-depth beyond the orchestrator's
 * pre-check, so a future caller (e.g. the click iteration) cannot bypass it.
 * Throws a plain Error (not the server's PermissionDeniedError) to avoid a
 * runtime `@poe-sniper/server` value-import in the packaged main.
 */
export function requireGrant(
  probe: PermissionProbe,
  action: string,
  kinds: PermissionKind[],
): void {
  for (const kind of kinds) {
    if (probe.query(kind) !== 'granted') {
      throw new Error(`${action} blocked — missing macOS permission: ${kind}`);
    }
  }
}
