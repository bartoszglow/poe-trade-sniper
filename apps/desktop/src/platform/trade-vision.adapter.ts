import type { FrameAnalysis, Point, RawFrame, TradeVision } from '@poe-sniper/server';

/** DEV-only: log each analysis (gated, since it runs in a tight pipeline). */
const VISION_DEBUG = process.env['BUY_DEBUG_DUMP_DIR'] != null;

/**
 * The SELECTED item's pulsing violet frame — both red & blue clearly above green,
 * blue not dim. Tuned to the measured selection violet (~r133 g97 b154).
 */
function isViolet(blue: number, green: number, red: number): boolean {
  return blue > 105 && red > 85 && green + 15 < red && green + 15 < blue;
}

/**
 * "Shop is open" signal: NEAR-BLACK coverage. The trade window is full of empty,
 * near-black grid cells + dark UI panels (merchant grid + the player inventory),
 * so a large fraction of the window is near-black whenever it's open — REGARDLESS
 * of the seller's hideout or the (varying) teleport loading art. Measured: shop
 * ~43%, hideout ~25%, loading screen ~30%. (Green failed — foliage in the hideout
 * matches the merchant's green. If dark proves fragile, upgrade to matching the
 * "MERCHANT" banner. TODO(verify) across sellers/full grids — O-10.)
 */
function isDarkUi(blue: number, green: number, red: number): boolean {
  return red + green + blue < 60;
}

/** The golden/tan "Leave Hideout" button text + ornate border (high red+green, low
 *  blue). Used only in the bottom-right HUD region for the return-to-hideout step. */
function isGold(blue: number, green: number, red: number): boolean {
  return red > 150 && green > 110 && blue < 115 && red > blue + 50 && green > blue + 25;
}
const LEAVE_REGION_X = 0.55; // search the bottom-right HUD quadrant only
const LEAVE_REGION_Y = 0.74;
const MIN_LEAVE_GOLD = 30; // gold samples to count as the button (vs stray gold)

const SAMPLE_STRIDE = 2; // sample every 2nd px (speed)
const CELL = 12; // coarse violet grid cell (px) — bridges the thin/pulsing outline
const MIN_CELL_HITS = 2; // violet samples in a cell to mark it "on"
const MIN_CLUSTER_HITS = 18; // total violet samples in the winning cluster
const MAX_BBOX_COVERAGE = 0.85; // reject a cluster spanning ~the whole window (noise)
const TOP_HUD_FRACTION = 0.08; // ignore the top skill/buff HUD strip (steady gem glow)
const MIN_SHOP_DARK_FRACTION = 0.37; // near-black coverage gate (shop ~43% vs ~25-30% elsewhere)

/** Largest non-runaway violet cluster below the HUD → its centre (frame px), via
 *  coarse-grid 8-connected components. Null when no real cluster is present. */
function violetClusterCenter(
  cellHits: Int32Array,
  cols: number,
  rows: number,
  width: number,
  height: number,
): Point | null {
  const visited = new Uint8Array(cols * rows);
  const stack: number[] = [];
  let best: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
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
    if (((minY + maxY) / 2) * CELL < height * TOP_HUD_FRACTION) continue; // skill/buff HUD
    const bestArea = best ? (best.maxX - best.minX + 1) * (best.maxY - best.minY + 1) : -1;
    if (!best || bboxArea > bestArea) best = { minX, minY, maxX, maxY };
  }
  if (!best) return null;
  const x = best.minX * CELL;
  const y = best.minY * CELL;
  const w = Math.min(width, (best.maxX + 1) * CELL) - x;
  const h = Math.min(height, (best.maxY + 1) * CELL) - y;
  return { x: Math.round(x + w / 2), y: Math.round(y + h / 2) };
}

/**
 * Raw-pixel trade vision — ONE strided traversal per frame computes both the
 * merchant-green "shop open" signal and the violet selection-frame grid (no
 * OpenCV / worker / OCR). The item is only located once the shop is open, so the
 * pulsing portal glows on the (hideout-dependent) loading screen — which look
 * violet but have no merchant green — can never be mistaken for an item.
 */
export function createRawPixelTradeVision(): TradeVision {
  return {
    analyze(frame: RawFrame): FrameAnalysis {
      const { width, height, pixels } = frame;
      if (width === 0 || height === 0) return { shopOpen: false, item: null };

      const cols = Math.ceil(width / CELL);
      const rows = Math.ceil(height / CELL);
      const cellHits = new Int32Array(cols * rows);
      let darkHits = 0;
      let samples = 0;
      for (let y = 0; y < height; y += SAMPLE_STRIDE) {
        const gridY = (y / CELL) | 0;
        for (let x = 0; x < width; x += SAMPLE_STRIDE) {
          samples += 1;
          const index = (y * width + x) * 4;
          const blue = pixels[index] ?? 0;
          const green = pixels[index + 1] ?? 0;
          const red = pixels[index + 2] ?? 0;
          if (isDarkUi(blue, green, red)) darkHits += 1;
          if (isViolet(blue, green, red)) {
            const cell = gridY * cols + ((x / CELL) | 0);
            cellHits[cell] = (cellHits[cell] ?? 0) + 1;
          }
        }
      }

      const darkFraction = samples > 0 ? darkHits / samples : 0;
      const shopOpen = darkFraction >= MIN_SHOP_DARK_FRACTION;
      const item = shopOpen ? violetClusterCenter(cellHits, cols, rows, width, height) : null;
      if (VISION_DEBUG) {
        console.warn(
          '[vision] analyze',
          JSON.stringify({
            frame: { w: width, h: height },
            darkFraction: +darkFraction.toFixed(3),
            shopOpen,
            item,
          }),
        );
      }
      return { shopOpen, item };
    },

    locateLeaveHideout(frame: RawFrame): Point | null {
      const { width, height, pixels } = frame;
      if (width === 0 || height === 0) return null;
      // Only the bottom-right HUD quadrant — avoids the golden quest text (upper
      // right) and the gold-count (bottom centre).
      const x0 = Math.floor(width * LEAVE_REGION_X);
      const y0 = Math.floor(height * LEAVE_REGION_Y);
      let count = 0;
      let minX = width;
      let minY = height;
      let maxX = 0;
      let maxY = 0;
      for (let y = y0; y < height; y += SAMPLE_STRIDE) {
        for (let x = x0; x < width; x += SAMPLE_STRIDE) {
          const index = (y * width + x) * 4;
          if (isGold(pixels[index] ?? 0, pixels[index + 1] ?? 0, pixels[index + 2] ?? 0)) {
            count += 1;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }
      const center =
        count >= MIN_LEAVE_GOLD ? { x: (minX + maxX) >> 1, y: (minY + maxY) >> 1 } : null;
      if (VISION_DEBUG) {
        console.warn('[vision] leaveHideout', JSON.stringify({ count, center }));
      }
      return center;
    },
  };
}
