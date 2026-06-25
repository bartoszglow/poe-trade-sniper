import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { nativeImage } from 'electron';
import type { CaptureSource, PermissionProbe, Point, RawFrame } from '@poe-sniper/server';
import { requireGrant } from './require-grant.js';

const execFileAsync = promisify(execFile);
const EMPTY_FRAME: RawFrame = { width: 0, height: 0, pixels: new Uint8Array(0) };
/** Reused temp path for the per-capture screenshot (JPEG — fast to encode). */
const captureShotPath = join(tmpdir(), 'poe-sniper-capture.jpg');

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

/**
 * Captures the game window and owns the one capture↔screen mapping. To stay fast
 * and correct on a WINDOWED, MULTI-MONITOR, HiDPI macOS setup:
 *  - `focusGameWindow` focuses AND reads the window's bounds in ONE title-matched
 *    osascript (no frontmost race → never Steam's window), caching the geometry.
 *  - `capture` takes a FRESH `screencapture -R` of the window rect (no stale
 *    desktopCapturer cache), so frame pixels are the window content at physical res.
 *  - `frameToScreen` maps a window-pixel point back to a global screen point via
 *    the window's logical bounds + the physical→logical scale (HiDPI + monitor offsets).
 * Self-gates Screen Recording. `gameWindowTitle` is pre-sanitized to `[A-Za-z0-9 ._-]`.
 */
export function createElectronCaptureSource(
  probe: PermissionProbe,
  gameWindowTitle: string,
  focusSettleMs: number,
): CaptureSource {
  let lastFocusedPid: string | null = null;
  // Locked atomically on focus. windowX/Y/W/H are the window in global LOGICAL
  // points; scaleX/Y (physical px per logical pt) is filled by capture().
  let geometry: {
    windowX: number;
    windowY: number;
    windowW: number;
    windowH: number;
    scaleX: number;
    scaleY: number;
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
    // scaleX/Y default to 1; capture() refines them from the screenshot's
    // physical size vs the window's logical size.
    geometry = {
      windowX: result.x,
      windowY: result.y,
      windowW: result.w,
      windowH: result.h,
      scaleX: 1,
      scaleY: 1,
    };
    console.warn(
      '[capture] locked',
      JSON.stringify({
        pid: result.pid,
        window: { x: result.x, y: result.y, w: result.w, h: result.h },
      }),
    );
    return true;
  }

  return {
    async capture(): Promise<RawFrame> {
      requireGrant(probe, 'capture', ['screenRecording']);
      const geo = geometry;
      if (!geo) return EMPTY_FRAME; // focus (which locks geometry) must run first
      // FRESH screenshot of the window region via macOS `screencapture`.
      // desktopCapturer.getSources returned a STALE/cached frame on every capture
      // AFTER the first (only a cold focus-scan busted it), so warm buys re-detected
      // the previous buy's frame and the cursor landed on a frozen spot. `-R x,y,w,h`
      // takes global top-left points; `-x` is silent; without `-C` the cursor is
      // excluded (so it can't be mistaken for a violet pixel).
      try {
        await execFileAsync(
          'screencapture',
          [
            '-x',
            '-R',
            `${geo.windowX},${geo.windowY},${geo.windowW},${geo.windowH}`,
            // JPEG, not PNG: at this window's Retina resolution PNG encoding is the
            // dominant cost (~480ms vs ~160ms for JPEG); the lossy artifacts don't
            // affect the wide CV thresholds (dark coverage / bright violet).
            '-t',
            'jpg',
            captureShotPath,
          ],
          { timeout: OSASCRIPT_TIMEOUT_MS, killSignal: 'SIGKILL' },
        );
      } catch (error) {
        console.warn(
          '[capture] screencapture failed:',
          error instanceof Error ? error.message : error,
        );
        return EMPTY_FRAME;
      }
      const image = nativeImage.createFromPath(captureShotPath);
      if (image.isEmpty()) return EMPTY_FRAME;
      const size = image.getSize();
      // The shot IS the window at PHYSICAL resolution → frame px per logical pt.
      geo.scaleX = geo.windowW === 0 ? 1 : size.width / geo.windowW;
      geo.scaleY = geo.windowH === 0 ? 1 : size.height / geo.windowH;
      const frame: RawFrame = { width: size.width, height: size.height, pixels: image.toBitmap() };
      if (DEBUG_DUMP_DIR && dumpSeq < DEBUG_DUMP_FRAMES) {
        dumpPng(`cap-${dumpSeq}`, frame);
        const purple = analyzePurple(frame);
        dumpPng(`cap-mask-${dumpSeq}`, purple.mask);
        console.warn(
          '[capture] dump',
          JSON.stringify({
            seq: dumpSeq,
            w: frame.width,
            h: frame.height,
            scaleX: geo.scaleX,
            cropStats: frameStats(frame),
            purple: { count: purple.count, avg: purple.avg, bbox: purple.bbox },
          }),
        );
        dumpSeq += 1;
      }
      return frame;
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
