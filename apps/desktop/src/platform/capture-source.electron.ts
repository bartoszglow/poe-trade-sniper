import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { desktopCapturer, nativeImage, screen } from 'electron';
import type { CaptureSource, PermissionProbe, Point, RawFrame } from '@poe-sniper/server';
import { requireGrant } from './require-grant.js';

const execFileAsync = promisify(execFile);
const EMPTY_FRAME: RawFrame = { width: 0, height: 0, pixels: new Uint8Array(0) };

/** DEV ONLY: when set, capture() writes the first frames of each buy as PNGs here
 *  (full display + cropped window) + logs pixel stats, so the actual capture can
 *  be inspected (is it black? right crop? what colour is the selection frame?). */
const DEBUG_DUMP_DIR = process.env['BUY_DEBUG_DUMP_DIR'] ?? null;
const DEBUG_DUMP_FRAMES = 8;
let dumpSeq = 0;

/** Strided pixel stats for a BGRA frame — non-black coverage, mean luma, and a
 *  rough violet count — to tell black-vs-content + violet presence numerically. */
function frameStats(frame: RawFrame): { nonBlackPct: number; violet: number; meanLuma: number } {
  const { width, height, pixels } = frame;
  if (width === 0 || height === 0) return { nonBlackPct: 0, violet: 0, meanLuma: 0 };
  let nonBlack = 0;
  let violet = 0;
  let lumaSum = 0;
  let samples = 0;
  for (let y = 0; y < height; y += 4) {
    for (let x = 0; x < width; x += 4) {
      const index = (y * width + x) * 4;
      const blue = pixels[index] ?? 0;
      const green = pixels[index + 1] ?? 0;
      const red = pixels[index + 2] ?? 0;
      samples += 1;
      lumaSum += (red + green + blue) / 3;
      if (red + green + blue > 72) nonBlack += 1;
      if (red > 120 && blue > 120 && green < 90 && Math.abs(red - blue) < 80) violet += 1;
    }
  }
  return {
    nonBlackPct: Math.round((nonBlack / samples) * 100),
    violet,
    meanLuma: Math.round(lumaSum / samples),
  };
}

/** DEV: reveal the REAL selection-frame colour. Over candidate "purple" pixels
 *  (red & blue both clearly above green), report count + average RGB + bbox, and
 *  build a black/white mask frame (white = candidate) to dump as a PNG so the
 *  matched shape is visible. Looser than `isViolet` on purpose — it's the probe. */
function analyzePurple(frame: RawFrame): {
  count: number;
  avg: { r: number; g: number; b: number };
  bbox: { x: number; y: number; width: number; height: number } | null;
  mask: RawFrame;
} {
  const { width, height, pixels } = frame;
  const mask = new Uint8Array(width * height * 4);
  let count = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const blue = pixels[index] ?? 0;
      const green = pixels[index + 1] ?? 0;
      const red = pixels[index + 2] ?? 0;
      const isCandidate = red > 90 && blue > 90 && green < red - 15 && green < blue - 15;
      mask[index + 3] = 255; // opaque
      if (isCandidate) {
        count += 1;
        sumR += red;
        sumG += green;
        sumB += blue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        mask[index] = 255;
        mask[index + 1] = 255;
        mask[index + 2] = 255;
      }
    }
  }
  return {
    count,
    avg: count
      ? { r: Math.round(sumR / count), g: Math.round(sumG / count), b: Math.round(sumB / count) }
      : { r: 0, g: 0, b: 0 },
    bbox: count ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null,
    mask: { width, height, pixels: mask },
  };
}

function dumpPng(label: string, frame: RawFrame): void {
  if (!DEBUG_DUMP_DIR || frame.width === 0 || frame.height === 0) return;
  try {
    const png = nativeImage
      .createFromBitmap(Buffer.from(frame.pixels), { width: frame.width, height: frame.height })
      .toPNG();
    writeFileSync(join(DEBUG_DUMP_DIR, `${label}.png`), png);
  } catch (error) {
    console.warn('[capture] dump failed:', error instanceof Error ? error.message : error);
  }
}
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
function focusAndReadWindowScript(title: string, settleMs: number, narrow: boolean): string {
  const settleSeconds = (settleMs / 1000).toFixed(3);
  // The game runs under Wine, so the process is named "wine" — scanning only
  // those (~10) is far cheaper than every GUI process's every window (each window
  // query is a slow Apple Event from Electron). `narrow=false` is the safety net.
  const filter = narrow ? 'name contains "wine"' : 'background only is false';
  return [
    'tell application "System Events"',
    `  repeat with proc in (every process whose ${filter})`,
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

/**
 * FAST PATH: focus a KNOWN process by pid and read its window-1 bounds, WITHOUT
 * enumerating every window of every process (the ~3s cost). Verifies the window
 * title still matches so a recycled pid can't focus the wrong app. Returns
 * "pid|x,y,w,h" / "wrong" / "missing". `pid` is digits-only (validated).
 */
function focusByPidScript(pid: string, title: string, settleMs: number): string {
  const settleSeconds = (settleMs / 1000).toFixed(3);
  // ONE `tell (process whose unix id is …)` block — minimal Apple Events (each
  // round-trip is ~100ms when sent from the Electron app, so the count matters).
  // A dead pid errors → caller falls back to the scan; a recycled pid fails the
  // title check → "wrong".
  return [
    'tell application "System Events"',
    `  tell (first process whose unix id is ${pid})`,
    '    if (count of windows) is 0 then return "missing"',
    `    if (name of window 1) does not contain "${title}" then return "wrong"`,
    '    set frontmost to true',
    `    delay ${settleSeconds}`,
    '    set p to position of window 1',
    '    set s to size of window 1',
    `    return "${pid}|" & ((item 1 of p) as text) & "," & ((item 2 of p) as text) & "," & ((item 1 of s) as text) & "," & ((item 2 of s) as text)`,
    '  end tell',
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
  // After the first successful focus we remember the game's pid and re-focus it
  // DIRECTLY next time (no per-window scan — that scan is the ~3s cost). A restart
  // recycles the pid, so the by-pid script verifies the title and asks for a
  // re-scan on a miss.
  let cachedPid: string | null = null;

  type FocusResult = { pid: string; x: number; y: number; w: number; h: number };

  /** Run a focus osascript and parse "pid|x,y,w,h" → bounds, "wrong"/"missing" →
   *  'retry' (cached pid stale), anything else / error → null. */
  async function runFocus(script: string): Promise<FocusResult | 'retry' | null> {
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync('osascript', ['-e', script], {
        timeout: OSASCRIPT_TIMEOUT_MS,
        killSignal: 'SIGKILL',
      }));
    } catch (error) {
      const detail = error as { stderr?: string; signal?: string; killed?: boolean };
      console.warn(
        '[focus] osascript failed:',
        JSON.stringify({
          stderr: detail.stderr?.trim(),
          signal: detail.signal,
          killed: detail.killed,
        }),
      );
      return null;
    }
    const text = stdout.trim();
    if (text === 'wrong' || text === 'missing') return 'retry';
    const [pid, rect] = text.split('|');
    const parts = (rect ?? '').split(',').map((value) => Number(value.trim()));
    if (
      text === 'not-found' ||
      !pid ||
      parts.length !== 4 ||
      parts.some((value) => !Number.isFinite(value))
    ) {
      return null;
    }
    const [x, y, w, h] = parts as [number, number, number, number];
    return { pid, x, y, w, h };
  }

  /** Cache the pid + lock the capture geometry from a focus result. */
  function applyFocus(result: FocusResult): boolean {
    lastFocusedPid = result.pid;
    cachedPid = /^\d+$/.test(result.pid) ? result.pid : null;
    const center = {
      x: Math.round(result.x + result.w / 2),
      y: Math.round(result.y + result.h / 2),
    };
    const display = screen.getDisplayNearestPoint(center);
    geometry = {
      displayId: String(display.id),
      thumbWidth: display.size.width,
      thumbHeight: display.size.height,
      displayOriginX: display.bounds.x,
      displayOriginY: display.bounds.y,
      windowX: result.x,
      windowY: result.y,
      windowW: result.w,
      windowH: result.h,
      scaleX: 1,
      scaleY: 1,
      cropW: result.w,
      cropH: result.h,
    };
    console.warn(
      '[capture] locked',
      JSON.stringify({
        pid: result.pid,
        window: { x: result.x, y: result.y, w: result.w, h: result.h },
        displayId: display.id,
        displayBounds: display.bounds,
        displaySize: display.size,
      }),
    );
    return true;
  }

  return {
    async capture(): Promise<RawFrame> {
      requireGrant(probe, 'capture', ['screenRecording']);
      const geo = geometry;
      if (!geo) return EMPTY_FRAME; // focus (which locks geometry) must run first
      const tGetSources = Date.now();
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: geo.thumbWidth, height: geo.thumbHeight },
      });
      const getSourcesMs = Date.now() - tGetSources;
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
      const cropped = cropFrame(full, cropX, cropY, geo.cropW, geo.cropH);
      if (DEBUG_DUMP_DIR && dumpSeq < DEBUG_DUMP_FRAMES) {
        const tDump = Date.now();
        dumpPng(`cap-full-${dumpSeq}`, full);
        dumpPng(`cap-crop-${dumpSeq}`, cropped);
        const purple = analyzePurple(cropped);
        dumpPng(`cap-mask-${dumpSeq}`, purple.mask);
        console.warn(
          '[capture] dump',
          JSON.stringify({
            seq: dumpSeq,
            getSourcesMs,
            dumpMs: Date.now() - tDump,
            crop: {
              x: Math.round(cropX),
              y: Math.round(cropY),
              w: cropped.width,
              h: cropped.height,
            },
            cropStats: frameStats(cropped),
            purple: { count: purple.count, avg: purple.avg, bbox: purple.bbox },
          }),
        );
        dumpSeq += 1;
      } else if (DEBUG_DUMP_DIR) {
        console.warn(
          '[capture] timing',
          JSON.stringify({ getSourcesMs, w: cropped.width, h: cropped.height }),
        );
      }
      return cropped;
    },

    async focusGameWindow(): Promise<boolean> {
      dumpSeq = 0; // fresh debug frames per buy (DEBUG_DUMP_DIR only)
      // Fast path: re-focus the cached pid directly — minimal Apple Events.
      if (cachedPid) {
        const fast = await runFocus(focusByPidScript(cachedPid, gameWindowTitle, focusSettleMs));
        if (fast && fast !== 'retry') return applyFocus(fast);
        cachedPid = null; // stale (restart / window gone) → re-acquire by scan
      }
      // Cold path: scan the Wine processes first, then every GUI process as a
      // fallback (also re-acquires the pid for the next fast path).
      for (const narrow of [true, false]) {
        const found = await runFocus(
          focusAndReadWindowScript(gameWindowTitle, focusSettleMs, narrow),
        );
        if (found && found !== 'retry') return applyFocus(found);
      }
      lastFocusedPid = null;
      geometry = null;
      return false;
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
