import { shell, systemPreferences } from 'electron';
import type { PermissionKind, PermissionProbe, PermissionState } from '@poe-sniper/server';

/**
 * macOS System Settings panes (TODO(verify): exact URLs per macOS version —
 * record in docs/integration/ with date, same evidence discipline as the GGG API).
 */
const SETTINGS_PANE: Record<PermissionKind, string> = {
  screenRecording: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
};

function mapScreenStatus(status: string): PermissionState {
  switch (status) {
    case 'granted':
      return 'granted';
    case 'denied':
      return 'denied';
    case 'restricted':
      return 'restricted';
    case 'not-determined':
      return 'not-determined';
    default:
      return 'not-determined'; // 'unknown' — treat as askable
  }
}

/**
 * Real macOS permission probe (Electron `systemPreferences`). Only meaningful in
 * an Electron main process; off-darwin every query is `'unsupported'`. Status is
 * read-only here (Option A) — the app reflects + requests, never revokes.
 */
export function createElectronPermissionProbe(): PermissionProbe {
  const isMac = process.platform === 'darwin';

  const openPane = (kind: PermissionKind): void => {
    if (!isMac) return;
    void shell.openExternal(SETTINGS_PANE[kind]);
  };

  return {
    query: (kind: PermissionKind): PermissionState => {
      if (!isMac) return 'unsupported';
      if (kind === 'screenRecording') {
        return mapScreenStatus(systemPreferences.getMediaAccessStatus('screen'));
      }
      // Accessibility (no prompt on a pure read). The API is boolean-only, so a
      // non-trusted client reads as askable rather than hard-denied.
      // TODO(verify): confirm denied-vs-not-determined on the target macOS and
      // record in docs/integration/ (extends the no-guessing discipline to TCC).
      return systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'not-determined';
    },

    request: (kind: PermissionKind): Promise<void> => {
      if (!isMac) return Promise.resolve();
      // Accessibility has a system prompt; Screen Recording has none (the OS
      // prompts on first capture) — so both also deep-link to their pane.
      if (kind === 'accessibility') systemPreferences.isTrustedAccessibilityClient(true);
      openPane(kind);
      return Promise.resolve();
    },

    openSettingsPane: openPane,
  };
}
