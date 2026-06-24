import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { desktopCapturer, screen } from 'electron';
import type { CaptureSource, PermissionProbe, RawFrame } from '@poe-sniper/server';
import { requireGrant } from './require-grant.js';

const execFileAsync = promisify(execFile);
const EMPTY_FRAME: RawFrame = { width: 0, height: 0, pixels: new Uint8Array(0) };

/**
 * Captures the primary screen via Electron `desktopCapturer` at LOGICAL
 * resolution (thumbnail = display size), so a frame pixel maps 1:1 to a screen
 * logical point — no HiDPI math downstream (resolves O-8 by construction).
 * Self-gates Screen Recording (decision #3). Focus uses `osascript` because the
 * game runs under Wine (a separate process); `gameProcessName` is pre-sanitized
 * by the caller to `[A-Za-z0-9 ._-]`.
 *
 * TODO(verify): toBitmap byte order (BGRA on macOS) + focus reliability under
 * Wine, against recorded fixtures on the dev Mac.
 */
export function createElectronCaptureSource(
  probe: PermissionProbe,
  gameProcessName: string,
): CaptureSource {
  return {
    async capture(): Promise<RawFrame> {
      requireGrant(probe, 'capture', ['screenRecording']);
      const display = screen.getPrimaryDisplay();
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: display.size,
      });
      const primary =
        sources.find((source) => source.display_id === String(display.id)) ?? sources[0];
      if (!primary || primary.thumbnail.isEmpty()) return EMPTY_FRAME;
      const size = primary.thumbnail.getSize();
      return {
        width: size.width,
        height: size.height,
        pixels: new Uint8Array(primary.thumbnail.toBitmap()),
      };
    },

    async focusGameWindow(): Promise<boolean> {
      try {
        await execFileAsync('osascript', [
          '-e',
          `tell application "System Events" to set frontmost of (first process whose name contains "${gameProcessName}") to true`,
        ]);
        return true;
      } catch {
        return false;
      }
    },

    async isGameWindowFocused(): Promise<boolean> {
      try {
        const { stdout } = await execFileAsync('osascript', [
          '-e',
          'tell application "System Events" to get name of first process whose frontmost is true',
        ]);
        return stdout.toLowerCase().includes(gameProcessName.toLowerCase());
      } catch {
        return false;
      }
    },
  };
}
