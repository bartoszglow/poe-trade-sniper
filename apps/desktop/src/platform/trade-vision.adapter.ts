import type { Point, RawFrame, TradeVision, WindowRegion } from '@poe-sniper/server';

/**
 * Locates the SELECTED trade item by its pulsing violet selection frame, via a
 * raw-pixel colour threshold — the approach proven in the feasibility spike, and
 * deliberately dependency-free (no OpenCV / worker thread). The capture is
 * logical-resolution, so cluster pixel coordinates ARE screen logical points.
 * Name-matching (OCR) is a later refinement; for the move-only Phase 2 we target
 * whatever item the operator has selected.
 *
 * TODO(verify): tune the violet threshold + min-cluster against recorded
 * trade-window fixtures on the dev Mac (O-10). Electron `toBitmap` is BGRA.
 */
const SAMPLE_STRIDE = 4; // sample every Nth pixel — fast enough at the ~100ms cadence
const MIN_CLUSTER_SAMPLES = 24; // ignore stray violet pixels

function isViolet(blue: number, green: number, red: number): boolean {
  return red > 120 && blue > 120 && green < 90 && Math.abs(red - blue) < 80;
}

function violetBounds(frame: RawFrame): WindowRegion | null {
  const { width, height, pixels } = frame;
  if (width === 0 || height === 0) return null;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let samples = 0;
  for (let y = 0; y < height; y += SAMPLE_STRIDE) {
    for (let x = 0; x < width; x += SAMPLE_STRIDE) {
      const index = (y * width + x) * 4;
      if (isViolet(pixels[index] ?? 0, pixels[index + 1] ?? 0, pixels[index + 2] ?? 0)) {
        samples += 1;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (samples < MIN_CLUSTER_SAMPLES) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function createRawPixelTradeVision(): TradeVision {
  return {
    detectTradeWindow(frame: RawFrame): Promise<WindowRegion | null> {
      return Promise.resolve(violetBounds(frame));
    },

    /**
     * Re-detects the violet cluster on the FRESH frame (verify-then-act): if the
     * selection vanished, returns null and the move is skipped. The passed
     * `region`/`target` are advisory — the fresh detection is authoritative.
     */
    locateItem(
      frame: RawFrame,
      _region: WindowRegion,
      _target: string | null,
    ): Promise<Point | null> {
      const bounds = violetBounds(frame);
      if (!bounds) return Promise.resolve(null);
      return Promise.resolve({
        x: Math.round(bounds.x + bounds.width / 2),
        y: Math.round(bounds.y + bounds.height / 2),
      });
    },
  };
}
