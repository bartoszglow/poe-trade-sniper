import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { desktopCapturer, screen } from 'electron';
import type { CaptureSource, PermissionProbe, RawFrame } from '@poe-sniper/server';
import { requireGrant } from './require-grant.js';

const execFileAsync = promisify(execFile);
const EMPTY_FRAME: RawFrame = { width: 0, height: 0, pixels: new Uint8Array(0) };
/** A wedged System Events / Automation prompt must never hang the buy run. */
const OSASCRIPT_TIMEOUT_MS = 5_000;

/**
 * AppleScript: focus the foreground process owning a window whose title contains
 * `title`; prints "ok" on success, "not-found" otherwise. Matches the WINDOW,
 * not the process — under Wine the process is just "wine" and there are two
 * (Steam + the game), so a name match focuses the wrong one. `title` is
 * pre-sanitized to `[A-Za-z0-9 ._-]`, so inlining it can't break the string.
 */
function focusByTitleScript(title: string): string {
  return [
    'tell application "System Events"',
    '  repeat with proc in (every process whose background only is false)',
    '    repeat with win in (windows of proc)',
    `      if (name of win) contains "${title}" then`,
    '        set frontmost of proc to true',
    '        return "ok"',
    '      end if',
    '    end repeat',
    '  end repeat',
    '  return "not-found"',
    'end tell',
  ].join('\n');
}

/** AppleScript: "true" if the frontmost process owns a window matching `title`. */
function frontmostHasTitleScript(title: string): string {
  return [
    'tell application "System Events"',
    '  set frontProc to first process whose frontmost is true',
    '  repeat with win in (windows of frontProc)',
    `    if (name of win) contains "${title}" then return "true"`,
    '  end repeat',
    '  return "false"',
    'end tell',
  ].join('\n');
}

/**
 * Captures the primary screen via Electron `desktopCapturer` at LOGICAL
 * resolution (thumbnail = display size), so a frame pixel maps 1:1 to a screen
 * logical point — no HiDPI math downstream (resolves O-8 by construction).
 * Self-gates Screen Recording (decision #3). Focus matches the game's WINDOW
 * TITLE via `osascript` (under Wine the process is just "wine", and there are
 * two of them — Steam + the game — so a process-name match focuses the wrong
 * one); `gameWindowTitle` is pre-sanitized by the caller to `[A-Za-z0-9 ._-]`.
 *
 * TODO(verify): toBitmap byte order (BGRA on macOS) + focus reliability under
 * Wine, against recorded fixtures on the dev Mac.
 */
export function createElectronCaptureSource(
  probe: PermissionProbe,
  gameWindowTitle: string,
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
      // toBitmap() already returns a Buffer (a Uint8Array snapshot) — return it
      // directly instead of forcing a second full-frame copy per capture (PERF-7).
      return { width: size.width, height: size.height, pixels: primary.thumbnail.toBitmap() };
    },

    async focusGameWindow(): Promise<boolean> {
      try {
        const { stdout } = await execFileAsync(
          'osascript',
          ['-e', focusByTitleScript(gameWindowTitle)],
          { timeout: OSASCRIPT_TIMEOUT_MS, killSignal: 'SIGKILL' },
        );
        return stdout.trim() === 'ok';
      } catch {
        return false;
      }
    },

    async isGameWindowFocused(): Promise<boolean> {
      try {
        const { stdout } = await execFileAsync(
          'osascript',
          ['-e', frontmostHasTitleScript(gameWindowTitle)],
          { timeout: OSASCRIPT_TIMEOUT_MS, killSignal: 'SIGKILL' },
        );
        return stdout.trim() === 'true';
      } catch {
        return false;
      }
    },
  };
}
