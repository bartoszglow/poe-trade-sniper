import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { desktopCapturer, screen } from 'electron';
import type { CaptureSource, PermissionProbe, Point, RawFrame } from '@poe-sniper/server';
import { requireGrant } from './require-grant.js';

const execFileAsync = promisify(execFile);
const EMPTY_FRAME: RawFrame = { width: 0, height: 0, pixels: new Uint8Array(0) };
/** Generous — the script includes an in-script settle delay; still bounded so a
 *  wedged System Events / Automation prompt never hangs the buy run. */
const OSASCRIPT_TIMEOUT_MS = 10_000;

/**
 * ONE atomic osascript: find the window whose title contains `title`, focus its
 * process, wait `settleMs` for the macOS Space-switch to settle, then return
 * "pid|x,y,w,h" of THAT window in global TOP-LEFT screen points — or "not-found".
 * Doing focus + bounds in a single matched-by-title call eliminates the race that
 * read the OTHER wine process's (Steam's) bounds. `title` is pre-sanitized to
 * `[A-Za-z0-9 ._-]`, so inlining it can't break the AppleScript string.
 */
function focusAndReadWindowScript(title: string, settleMs: number): string {
  const settleSeconds = (settleMs / 1000).toFixed(3);
  return [
    'tell application "System Events"',
    '  repeat with proc in (every process whose background only is false)',
    '    repeat with win in (windows of proc)',
    `      if (name of win) contains "${title}" then`,
    '        set frontmost of proc to true',
    `        delay ${settleSeconds}`,
    '        set p to position of win',
    '        set s to size of win',
    '        return ((unix id of proc) as text) & "|" & ((item 1 of p) as text) & "," & ((item 2 of p) as text) & "," & ((item 1 of s) as text) & "," & ((item 2 of s) as text)',
    '      end if',
    '    end repeat',
    '  end repeat',
    '  return "not-found"',
    'end tell',
  ].join('\n');
}

/** AppleScript: the unix id (pid) of the frontmost process — the focus backstop. */
const FRONTMOST_PID_SCRIPT =
  'tell application "System Events" to get unix id of (first process whose frontmost is true)';

/** Copy a sub-rectangle of a BGRA frame into its own tight buffer. */
function cropFrame(frame: RawFrame, cx: number, cy: number, cw: number, ch: number): RawFrame {
  const x0 = Math.max(0, Math.round(cx));
  const y0 = Math.max(0, Math.round(cy));
  const width = Math.min(Math.round(cw), frame.width - x0);
  const height = Math.min(Math.round(ch), frame.height - y0);
  if (width <= 0 || height <= 0) return EMPTY_FRAME;
  const pixels = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const srcStart = ((y0 + row) * frame.width + x0) * 4;
    pixels.set(frame.pixels.subarray(srcStart, srcStart + width * 4), row * width * 4);
  }
  return { width, height, pixels };
}

/**
 * Captures the game window and owns the one capture↔screen mapping. To stay fast
 * and correct on a WINDOWED, MULTI-MONITOR, HiDPI macOS setup:
 *  - `focusGameWindow` focuses AND reads the window's bounds in ONE title-matched
 *    osascript (no frontmost race → never Steam's window), caching the geometry.
 *  - `capture` grabs the display the window is on, then CROPS to the window rect,
 *    so the violet search is scoped to the game window (no whole-screen pollution)
 *    and frame pixels are window-relative.
 *  - `frameToScreen` maps a window-relative point back to a global screen point
 *    via the window's logical bounds (handles HiDPI + monitor offsets).
 * Self-gates Screen Recording. `gameWindowTitle` is pre-sanitized to `[A-Za-z0-9 ._-]`.
 */
export function createElectronCaptureSource(
  probe: PermissionProbe,
  gameWindowTitle: string,
  focusSettleMs: number,
): CaptureSource {
  let lastFocusedPid: string | null = null;
  // Locked atomically on focus. windowX/Y/W/H are the window in global LOGICAL
  // points; the rest (display + scale + crop in frame px) is filled by capture().
  let geometry: {
    displayId: string;
    thumbWidth: number;
    thumbHeight: number;
    displayOriginX: number;
    displayOriginY: number;
    windowX: number;
    windowY: number;
    windowW: number;
    windowH: number;
    scaleX: number;
    scaleY: number;
    cropW: number;
    cropH: number;
  } | null = null;

  return {
    async capture(): Promise<RawFrame> {
      requireGrant(probe, 'capture', ['screenRecording']);
      const geo = geometry;
      if (!geo) return EMPTY_FRAME; // focus (which locks geometry) must run first
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: geo.thumbWidth, height: geo.thumbHeight },
      });
      const source = sources.find((candidate) => candidate.display_id === geo.displayId);
      if (!source || source.thumbnail.isEmpty()) return EMPTY_FRAME;
      const size = source.thumbnail.getSize();
      // Frame pixels per logical point (1 when the thumbnail came back logical,
      // ~2 on physical HiDPI). Window rect within the display → crop in frame px.
      geo.scaleX = size.width === 0 ? 1 : size.width / geo.thumbWidth;
      geo.scaleY = size.height === 0 ? 1 : size.height / geo.thumbHeight;
      const cropX = (geo.windowX - geo.displayOriginX) * geo.scaleX;
      const cropY = (geo.windowY - geo.displayOriginY) * geo.scaleY;
      geo.cropW = geo.windowW * geo.scaleX;
      geo.cropH = geo.windowH * geo.scaleY;
      const full: RawFrame = {
        width: size.width,
        height: size.height,
        pixels: source.thumbnail.toBitmap(),
      };
      return cropFrame(full, cropX, cropY, geo.cropW, geo.cropH);
    },

    async focusGameWindow(): Promise<boolean> {
      let stdout: string;
      try {
        ({ stdout } = await execFileAsync(
          'osascript',
          ['-e', focusAndReadWindowScript(gameWindowTitle, focusSettleMs)],
          { timeout: OSASCRIPT_TIMEOUT_MS, killSignal: 'SIGKILL' },
        ));
      } catch (error) {
        const detail = error as { stderr?: string; signal?: string; killed?: boolean };
        console.warn(
          '[focus] focusAndRead failed:',
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
      const text = stdout.trim();
      const [pid, rect] = text.split('|');
      const parts = (rect ?? '').split(',').map((value) => Number(value.trim()));
      if (
        text === 'not-found' ||
        !pid ||
        parts.length !== 4 ||
        parts.some((v) => !Number.isFinite(v))
      ) {
        lastFocusedPid = null;
        geometry = null;
        return false;
      }
      const [windowX, windowY, windowW, windowH] = parts as [number, number, number, number];
      lastFocusedPid = pid;
      const center = { x: Math.round(windowX + windowW / 2), y: Math.round(windowY + windowH / 2) };
      const display = screen.getDisplayNearestPoint(center);
      geometry = {
        displayId: String(display.id),
        thumbWidth: display.size.width,
        thumbHeight: display.size.height,
        displayOriginX: display.bounds.x,
        displayOriginY: display.bounds.y,
        windowX,
        windowY,
        windowW,
        windowH,
        scaleX: 1,
        scaleY: 1,
        cropW: windowW,
        cropH: windowH,
      };
      console.warn(
        '[capture] locked',
        JSON.stringify({
          window: { x: windowX, y: windowY, w: windowW, h: windowH },
          displayId: display.id,
          displayBounds: display.bounds,
          displaySize: display.size,
        }),
      );
      return true;
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
      if (!geometry) return Promise.resolve(null);
      return Promise.resolve({
        x: Math.round(geometry.windowX + geometry.windowW / 2),
        y: Math.round(geometry.windowY + geometry.windowH / 2),
      });
    },

    frameToScreen(point: Point): Point {
      const geo = geometry;
      if (!geo || geo.scaleX === 0 || geo.scaleY === 0) return point;
      // point is in the CROPPED (window) frame → logical offset within the window
      // (÷ scale) → global screen point (+ window origin).
      const mapped = {
        x: Math.round(geo.windowX + point.x / geo.scaleX),
        y: Math.round(geo.windowY + point.y / geo.scaleY),
      };
      console.warn('[capture] frameToScreen', JSON.stringify({ frame: point, screen: mapped }));
      return mapped;
    },
  };
}
