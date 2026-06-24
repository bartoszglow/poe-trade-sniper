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

/** AppleScript: the unix id (pid) of the frontmost process (focus verify). */
const FRONTMOST_PID_SCRIPT =
  'tell application "System Events" to get unix id of (first process whose frontmost is true)';

/**
 * AppleScript: the frontmost process's window-1 "x,y,w,h" in global TOP-LEFT
 * screen points. Cheap — it touches ONLY the frontmost process (the game, right
 * after focus), NOT every window of every app (that enumeration is slow and was
 * starving the detect loop). Run once per buy to lock the capture geometry.
 */
const FRONTMOST_BOUNDS_SCRIPT = [
  'tell application "System Events"',
  '  tell (first process whose frontmost is true)',
  '    set p to position of window 1',
  '    set s to size of window 1',
  '  end tell',
  '  return ((item 1 of p) as text) & "," & ((item 2 of p) as text) & "," & ((item 1 of s) as text) & "," & ((item 2 of s) as text)',
  'end tell',
].join('\n');

/**
 * Captures the DISPLAY the game window is on and owns the one capture↔screen
 * mapping. To stay fast — osascript window enumeration is slow and per-frame
 * calls were starving the detect loop — the geometry is locked ONCE per buy
 * inside `focusGameWindow` (from the now-frontmost game window), and `capture`
 * reuses it with NO further osascript. `frameToScreen` maps a violet-cluster
 * point to a cursor target; `windowCenter` returns the cached window centre.
 * Self-gates Screen Recording (decision #3). `gameWindowTitle` is pre-sanitized
 * by the caller to `[A-Za-z0-9 ._-]`.
 *
 * TODO(verify): toBitmap byte order (BGRA on macOS); nut.js point units vs the
 * logical mapping here (the [capture] logs confirm/tune it).
 */
export function createElectronCaptureSource(
  probe: PermissionProbe,
  gameWindowTitle: string,
): CaptureSource {
  // The pid we last focused — focus is verified by comparing the frontmost pid
  // to this (robust against a fullscreen window hiding its title).
  let lastFocusedPid: string | null = null;
  // Locked on focus from the game window + its display; reused by capture /
  // windowCenter / frameToScreen with NO per-frame osascript.
  let geometry: {
    displayId: string;
    thumbWidth: number;
    thumbHeight: number;
    originX: number;
    originY: number;
    scaleX: number;
    scaleY: number;
    center: Point;
  } | null = null;

  async function readFrontmostBounds(): Promise<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null> {
    try {
      const { stdout } = await execFileAsync('osascript', ['-e', FRONTMOST_BOUNDS_SCRIPT], {
        timeout: OSASCRIPT_TIMEOUT_MS,
        killSignal: 'SIGKILL',
      });
      const parts = stdout
        .trim()
        .split(',')
        .map((value) => Number(value.trim()));
      if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) return null;
      const [x, y, width, height] = parts as [number, number, number, number];
      return { x, y, width, height };
    } catch (error) {
      console.warn('[capture] bounds failed:', error instanceof Error ? error.message : error);
      return null;
    }
  }

  /** Lock the capture geometry from the (just-focused, frontmost) game window. */
  async function lockGeometry(): Promise<void> {
    const bounds = await readFrontmostBounds();
    if (!bounds) {
      geometry = null;
      return;
    }
    const center = {
      x: Math.round(bounds.x + bounds.width / 2),
      y: Math.round(bounds.y + bounds.height / 2),
    };
    const display = screen.getDisplayNearestPoint(center);
    geometry = {
      displayId: String(display.id),
      thumbWidth: display.size.width,
      thumbHeight: display.size.height,
      originX: display.bounds.x,
      originY: display.bounds.y,
      scaleX: 1,
      scaleY: 1, // refined in capture() once the actual frame size is known
      center,
    };
    console.warn(
      '[capture] geometry locked',
      JSON.stringify({ bounds, center, displayId: display.id, displaySize: display.size }),
    );
  }

  return {
    async capture(): Promise<RawFrame> {
      requireGrant(probe, 'capture', ['screenRecording']);
      const cached = geometry;
      const display = cached
        ? (screen.getAllDisplays().find((entry) => String(entry.id) === cached.displayId) ??
          screen.getPrimaryDisplay())
        : screen.getPrimaryDisplay();
      const thumbnailSize = cached
        ? { width: cached.thumbWidth, height: cached.thumbHeight }
        : display.size;
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize });
      const source =
        sources.find((candidate) => candidate.display_id === String(display.id)) ?? sources[0];
      if (!source || source.thumbnail.isEmpty()) return EMPTY_FRAME;
      const size = source.thumbnail.getSize();
      if (cached) {
        cached.scaleX = size.width === 0 ? 1 : cached.thumbWidth / size.width;
        cached.scaleY = size.height === 0 ? 1 : cached.thumbHeight / size.height;
      }
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
          geometry = null;
          return false;
        }
        lastFocusedPid = result;
        await lockGeometry();
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
        geometry = null;
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

    windowCenter(): Promise<Point | null> {
      return Promise.resolve(geometry ? geometry.center : null);
    },

    frameToScreen(point: Point): Point {
      if (!geometry) return point;
      return {
        x: Math.round(geometry.originX + point.x * geometry.scaleX),
        y: Math.round(geometry.originY + point.y * geometry.scaleY),
      };
    },
  };
}
