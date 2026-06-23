/**
 * macOS TCC permissions the desktop automation depends on. Cross-platform-safe:
 * non-macOS shells report every kind as `'unsupported'`.
 */
export const PERMISSION_KINDS = ['screenRecording', 'accessibility'] as const;
export type PermissionKind = (typeof PERMISSION_KINDS)[number];

/**
 * Live OS permission state.
 * - `restricted` = locked by MDM/organization — the user cannot change it.
 * - `not-determined` = never asked.
 * - `unsupported` = a platform without this TCC concept (web / Windows / CLI).
 */
export type PermissionState =
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'not-determined'
  | 'unsupported';

/** Per-kind live status (the `status()` payload + the `/api/status` field). */
export type PermissionsStatus = Record<PermissionKind, PermissionState>;

/**
 * The ONE predicate that means "the app may proceed" — shared by the server-side
 * gate AND the UI so they can never diverge. Only an explicit `granted` passes.
 */
export function isGrant(state: PermissionState): boolean {
  return state === 'granted';
}

export type PermissionSeverity = 'ok' | 'warn' | 'danger' | 'muted';

/**
 * Semantic interpretation of a state, shared by gate + UI. The UI maps
 * `severity` to its Badge tone and supplies its own localized copy (kept out of
 * shared so the catalog stays web-only).
 */
export function describeState(state: PermissionState): {
  granted: boolean;
  severity: PermissionSeverity;
} {
  switch (state) {
    case 'granted':
      return { granted: true, severity: 'ok' };
    case 'denied':
      return { granted: false, severity: 'danger' };
    case 'restricted':
      return { granted: false, severity: 'warn' };
    case 'not-determined':
      return { granted: false, severity: 'warn' };
    case 'unsupported':
      return { granted: false, severity: 'muted' };
  }
}

/**
 * The preload `contextBridge` surface (renderer ↔ Electron main). Typed in
 * shared so both sides reference one contract and can't drift. Status itself is
 * NOT here — it flows over `/api/status` (single source of truth); this exposes
 * only the two acts HTTP cannot do.
 */
export interface DesktopPermissionsApi {
  /** Prompt for / deep-link to the grant flow for a kind (fire-and-forget). */
  requestPermission(kind: PermissionKind): void;
  /** Open the System Settings pane for a kind so the user can manage/revoke. */
  openSettingsPane(kind: PermissionKind): void;
}
