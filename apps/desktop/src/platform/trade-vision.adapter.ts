import type { Point, RawFrame, TradeVision, WindowRegion } from '@poe-sniper/server';

/**
 * Locates the SELECTED trade item by its pulsing violet selection frame, via a
 * raw-pixel colour threshold + a coarse-grid connected-components pass — no
 * OpenCV / worker thread.
 *
 * Why not a global violet bounding box (the original approach): PoE's UI has
 * violet scattered everywhere (gem icons, item glows, grid tint), so min/max
 * over ALL violet pixels stretches across the whole window and the centre lands
 * nowhere near the item (measured: a 1413×772 bbox on a 1455×960 window). The
 * selection frame is instead a DENSE, connected rectangle that stands out from
 * the sparse noise — so we grid the frame into cells, keep cells with enough
 * violet, connect them (8-way, which bridges the thin/pulsing outline and small
 * gaps), discard isolated specks, and take the largest non-runaway cluster.
 *
 * Threshold tuned to the measured selection-frame colour (~r133 g97 b154, a
 * blue-leaning violet): both red & blue clearly above green, blue not dim. The
 * blue floor rejects the dim-blue grid cells; the green gap rejects bright/white
 * UI. The frame PULSES, so the threshold stays loose enough to catch dim phases
 * and the buy loop re-captures until a frame is found. (O-10 — tuned on-Mac.)
 */
function isViolet(blue: number, green: number, red: number): boolean {
  return blue > 105 && red > 85 && green + 15 < red && green + 15 < blue;
}

/** DEV-only: log each detection (gated, since detection runs in a tight loop). */
const VISION_DEBUG = process.env['BUY_DEBUG_DUMP_DIR'] != null;
const SAMPLE_STRIDE = 2; // sample every 2nd px when building the grid (speed)
const CELL = 12; // coarse grid cell size (px) — bridges the thin/broken outline
const MIN_CELL_HITS = 2; // violet samples in a cell to mark it "on"
const MIN_CLUSTER_HITS = 18; // total violet samples in the winning cluster
const MAX_BBOX_COVERAGE = 0.85; // reject a cluster spanning ~the whole window (noise)
const TOP_HUD_FRACTION = 0.08; // ignore the top skill/buff HUD strip (steady gem glow)

/**
 * Find the selected-item selection frame and return its pixel bounding box, or
 * null when no dense violet cluster is present (no item selected / trade closed).
 */
function detectSelectionFrame(frame: RawFrame): WindowRegion | null {
  const { width, height, pixels } = frame;
  if (width === 0 || height === 0) return null;

  const cols = Math.ceil(width / CELL);
  const rows = Math.ceil(height / CELL);
  const cellHits = new Int32Array(cols * rows);
  for (let y = 0; y < height; y += SAMPLE_STRIDE) {
    const gridY = (y / CELL) | 0;
    for (let x = 0; x < width; x += SAMPLE_STRIDE) {
      const index = (y * width + x) * 4;
      if (isViolet(pixels[index] ?? 0, pixels[index + 1] ?? 0, pixels[index + 2] ?? 0)) {
        const cell = gridY * cols + ((x / CELL) | 0);
        cellHits[cell] = (cellHits[cell] ?? 0) + 1;
      }
    }
  }

  // Largest 8-connected cluster of "on" cells (iterative flood fill).
  const visited = new Uint8Array(cols * rows);
  const stack: number[] = [];
  let best: { hits: number; minX: number; minY: number; maxX: number; maxY: number } | null = null;
  let clusters = 0;
  for (let start = 0; start < cellHits.length; start += 1) {
    if (visited[start] || (cellHits[start] ?? 0) < MIN_CELL_HITS) continue;
    stack.length = 0;
    stack.push(start);
    visited[start] = 1;
    let hits = 0;
    let minX = cols;
    let minY = rows;
    let maxX = 0;
    let maxY = 0;
    while (stack.length > 0) {
      const cell = stack.pop() as number;
      const cellX = cell % cols;
      const cellY = (cell / cols) | 0;
      hits += cellHits[cell] ?? 0;
      if (cellX < minX) minX = cellX;
      if (cellY < minY) minY = cellY;
      if (cellX > maxX) maxX = cellX;
      if (cellY > maxY) maxY = cellY;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = cellX + dx;
          const ny = cellY + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const neighbour = ny * cols + nx;
          if (!visited[neighbour] && (cellHits[neighbour] ?? 0) >= MIN_CELL_HITS) {
            visited[neighbour] = 1;
            stack.push(neighbour);
          }
        }
      }
    }
    if (hits < MIN_CLUSTER_HITS) continue;
    const bboxArea = (maxX - minX + 1) * (maxY - minY + 1);
    if (bboxArea / (cols * rows) > MAX_BBOX_COVERAGE) continue; // runaway noise
    // Skip the top skill/buff HUD strip — a steady gem there is the same size as
    // a 1×1 item frame, so size can't tell them apart; position can.
    if (((minY + maxY) / 2) * CELL < height * TOP_HUD_FRACTION) continue;
    clusters += 1;
    const bestArea = best ? (best.maxX - best.minX + 1) * (best.maxY - best.minY + 1) : -1;
    if (!best || bboxArea > bestArea) best = { hits, minX, minY, maxX, maxY };
  }

  if (!best) return null;
  const x = best.minX * CELL;
  const y = best.minY * CELL;
  const region = {
    x,
    y,
    width: Math.min(width, (best.maxX + 1) * CELL) - x,
    height: Math.min(height, (best.maxY + 1) * CELL) - y,
  };
  if (VISION_DEBUG) {
    console.warn(
      '[vision] frame',
      JSON.stringify({
        frame: { w: width, h: height },
        clusters,
        hits: best.hits,
        region,
        center: { x: region.x + ((region.width / 2) | 0), y: region.y + ((region.height / 2) | 0) },
      }),
    );
  }
  return region;
}

export function createRawPixelTradeVision(): TradeVision {
  return {
    detectTradeWindow(frame: RawFrame): Promise<WindowRegion | null> {
      return Promise.resolve(detectSelectionFrame(frame));
    },

    /**
     * Re-detects the selection frame on the FRESH frame (verify-then-act): if the
     * selection vanished, returns null and the move is skipped. The passed
     * `region`/`target` are advisory — the fresh detection is authoritative.
     */
    locateItem(
      frame: RawFrame,
      _region: WindowRegion,
      _target: string | null,
    ): Promise<Point | null> {
      const bounds = detectSelectionFrame(frame);
      if (!bounds) return Promise.resolve(null);
      return Promise.resolve({
        x: Math.round(bounds.x + bounds.width / 2),
        y: Math.round(bounds.y + bounds.height / 2),
      });
    },
  };
}
