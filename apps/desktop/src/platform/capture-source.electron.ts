import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { desktopCapturer, screen } from 'electron';
import type { CaptureSource, PermissionProbe, Point, RawFrame } from '@poe-sniper/server';
import { requireGrant } from './require-grant.js';

const execFileAsync = promisify(execFile);
const EMPTY_FRAME: RawFrame = { width: 0, height: 0, pixels: new Uint8Array(0) };
/** A wedged System Events / Automation prompt must never hang the buy run. */
const OSASCRIPT_TIMEOUT_MS = 5_000;

/**
 * AppleScript: focus the foreground process owning a window whose title contains
 * `title`, and print that process's unix id (pid) — or "not-found". Matches the
 * WINDOW, not the process: under Wine the process is just "wine" and there are
 * two (Steam + the game), so a name match focuses the wrong one. `title` is
 * pre-sanitized to `[A-Za-z0-9 ._-]`, so inlining it can't break the string.
 */
function focusByTitleScript(title: string): string {
  return [
    'tell application "System Events"',
    '  repeat with proc in (every process whose background only is false)',
    '    repeat with win in (windows of proc)',
    `      if (name of win) contains "${title}" then`,
    '        set frontmost of proc to true',
    '        return (unix id of proc) as string',
    '      end if',
    '    end repeat',
    '  end repeat',
    '  return "not-found"',
    'end tell',
  ].join('\n');
}

/**
 * AppleScript: the unix id (pid) of the frontmost process. Focus is verified by
 * comparing this to the pid we just focused — NOT by re-reading a window title,
 * because a fullscreen Wine window often stops exposing its title to `windows
 * of`, which made a title-based verify false-fail right after focus.
 */
const FRONTMOST_PID_SCRIPT =
  'tell application "System Events" to get unix id of (first process whose frontmost is true)';

/**
 * AppleScript: print the game window's "x,y,w,h" in global TOP-LEFT screen points
 * (the Accessibility API's origin, same space Electron + nut.js use) — or
 * "not-found". Used to pick the display the game is on, centre the cursor in the
 * window, and anchor the frame→screen mapping.
 */
function windowBoundsScript(title: string): string {
  return [
    'tell application "System Events"',
    '  repeat with proc in (every process whose background only is false)',
    '    repeat with win in (windows of proc)',
    `      if (name of win) contains "${title}" then`,
    '        set p to position of win',
    '        set s to size of win',
    '        return ((item 1 of p) as text) & "," & ((item 2 of p) as text) & "," & ((item 1 of s) as text) & "," & ((item 2 of s) as text)',
    '      end if',
    '    end repeat',
    '  end repeat',
    '  return "not-found"',
    'end tell',
  ].join('\n');
}

/**
 * Captures the DISPLAY the game window is on (multi-monitor aware) via Electron
 * `desktopCapturer`, and owns the one capture↔screen mapping: it caches the
 * captured display's global origin + the frame-pixel→logical scale so
 * `frameToScreen` turns a violet-cluster point into a real cursor target, and
 * exposes `windowCenter` so the orchestrator can park the cursor inside the game
 * on focus. Self-gates Screen Recording (decision #3). Focus matches the game's
 * WINDOW TITLE via `osascript` (under Wine the process is just "wine", and there
 * are two — Steam + the game — so a process-name match focuses the wrong one);
 * `gameWindowTitle` is pre-sanitized by the caller to `[A-Za-z0-9 ._-]`.
 *
 * TODO(verify): toBitmap byte order (BGRA on macOS); nut.js point units vs the
 * logical mapping here, against the dev Mac (the [capture] logs confirm/tune it).
 */
export function createElectronCaptureSource(
  probe: PermissionProbe,
  gameWindowTitle: string,
): CaptureSource {
  // The pid we last brought to the foreground — focus is verified by comparing
  // the frontmost pid to this (robust against a fullscreen window hiding its title).
  let lastFocusedPid: string | null = null;
  // Geometry of the last capture: the captured display's global-logical origin +
  // the frame-pixel→logical scale (HiDPI). Drives frameToScreen.
  let lastGeometry: { originX: number; originY: number; scaleX: number; scaleY: number } | null =
    null;

  async function readWindowBounds(): Promise<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null> {
    try {
      const { stdout } = await execFileAsync(
        'osascript',
        ['-e', windowBoundsScript(gameWindowTitle)],
        { timeout: OSASCRIPT_TIMEOUT_MS, killSignal: 'SIGKILL' },
      );
      const text = stdout.trim();
      if (text === '' || text === 'not-found') return null;
      const parts = text.split(',').map((value) => Number(value.trim()));
      if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) return null;
      const [x, y, width, height] = parts as [number, number, number, number];
      return { x, y, width, height };
    } catch (error) {
      console.warn(
        '[capture] window bounds failed:',
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  }

  return {
    async capture(): Promise<RawFrame> {
      requireGrant(probe, 'capture', ['screenRecording']);
      // Capture the display the game window sits on (fall back to primary).
      const bounds = await readWindowBounds();
      const display = bounds
        ? screen.getDisplayNearestPoint({
            x: Math.round(bounds.x + bounds.width / 2),
            y: Math.round(bounds.y + bounds.height / 2),
          })
        : screen.getPrimaryDisplay();
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: display.size,
      });
      const source =
        sources.find((candidate) => candidate.display_id === String(display.id)) ?? sources[0];
      if (!source || source.thumbnail.isEmpty()) {
        lastGeometry = null;
        return EMPTY_FRAME;
      }
      const size = source.thumbnail.getSize();
      // Anchor the frame→screen mapping: the display's global-logical origin + the
      // frame-pixel→logical scale (1 if the thumbnail came back logical, ~0.5 if
      // it came back at physical HiDPI resolution).
      lastGeometry = {
        originX: display.bounds.x,
        originY: display.bounds.y,
        scaleX: size.width === 0 ? 1 : display.size.width / size.width,
        scaleY: size.height === 0 ? 1 : display.size.height / size.height,
      };
      console.warn(
        '[capture] geometry',
        JSON.stringify({
          displayBounds: display.bounds,
          displaySize: display.size,
          frame: { width: size.width, height: size.height },
          scale: lastGeometry,
        }),
      );
      // toBitmap() already returns a Buffer (a Uint8Array snapshot) — return it
      // directly instead of forcing a second full-frame copy per capture (PERF-7).
      return { width: size.width, height: size.height, pixels: source.thumbnail.toBitmap() };
    },

    async focusGameWindow(): Promise<boolean> {
      try {
        const { stdout } = await execFileAsync(
          'osascript',
          ['-e', focusByTitleScript(gameWindowTitle)],
          { timeout: OSASCRIPT_TIMEOUT_MS, killSignal: 'SIGKILL' },
        );
        const result = stdout.trim();
        if (result === '' || result === 'not-found') {
          lastFocusedPid = null;
          return false;
        }
        lastFocusedPid = result;
        return true;
      } catch (error) {
        // Surface the osascript STDERR (the real reason: a TCC code like -1743, or
        // a SIGKILL from the timeout) — error.message only echoes the command.
        const detail = error as { stderr?: string; signal?: string; killed?: boolean };
        console.warn(
          '[focus] focusGameWindow failed:',
          JSON.stringify({
            stderr: detail.stderr?.trim(),
            signal: detail.signal,
            killed: detail.killed,
          }),
        );
        lastFocusedPid = null;
        return false;
      }
    },

    async isGameWindowFocused(): Promise<boolean> {
      if (lastFocusedPid === null) return false;
      try {
        const { stdout } = await execFileAsync('osascript', ['-e', FRONTMOST_PID_SCRIPT], {
          timeout: OSASCRIPT_TIMEOUT_MS,
          killSignal: 'SIGKILL',
        });
        return stdout.trim() === lastFocusedPid;
      } catch (error) {
        console.warn(
          '[focus] isGameWindowFocused failed:',
          error instanceof Error ? error.message : error,
        );
        return false;
      }
    },

    async windowCenter(): Promise<Point | null> {
      const bounds = await readWindowBounds();
      if (!bounds) return null;
      const center = {
        x: Math.round(bounds.x + bounds.width / 2),
        y: Math.round(bounds.y + bounds.height / 2),
      };
      console.warn('[capture] windowCenter', JSON.stringify({ bounds, center }));
      return center;
    },

    frameToScreen(point: Point): Point {
      if (!lastGeometry) return point;
      const mapped = {
        x: Math.round(lastGeometry.originX + point.x * lastGeometry.scaleX),
        y: Math.round(lastGeometry.originY + point.y * lastGeometry.scaleY),
      };
      console.warn('[capture] frameToScreen', JSON.stringify({ frame: point, screen: mapped }));
      return mapped;
    },
  };
}
