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

// "Leave Hideout" button — TWO heuristics (Bartosz's idea: location + a second check).
//
//  (1) LOCATION (anchor). Pure colour/template detection is unreliable: the quest
//      tracker is the SAME gold on a dark world, and the button's own gold is dim — so
//      gold can't be separated globally. Instead we anchor geometrically: PoE pins the
//      bottom HUD (incl. this button) to the bottom-right of the game viewport, sized
//      by viewport HEIGHT (the whole HUD scales with height). For the non-letterboxed
//      ratios that cover virtually all players (16:9 / 16:10 / 4:3 — viewport == window)
//      the button centre is a fixed height-scaled offset from the corner. Measured
//      on-device (2182x1594 → 1730,1330) and VERIFIED across ar 1.26 / 1.37 / 1.9:
//        dx = (W-cx)/H = 452/1594 = 0.284 ;  dy = (H-cy)/H = 264/1594 = 0.166
//
//  (2) GOLD VERIFICATION. Confirm the button's gold actually sits at the anchor: a
//      TIGHT box there is clean of the quest tracker (which hugs the far-right edge,
//      above). Present → trust the anchor. Absent → portrait / fullscreen-letterbox /
//      odd window where the viewport is above the window bottom → report not-found
//      (the caller skips, rather than clicking a wrong spot). We verify but do NOT snap
//      to a gold centroid: nearby gold (orb rim, gold-count, skill bar) drags it off by
//      100+px, and the anchor is already accurate. TODO(verify) letterbox + fullscreen
//      viewport detection — O-12.
const LEAVE_DX_OVER_HEIGHT = 0.284; // anchor is this * height LEFT of the right edge
const LEAVE_DY_OVER_HEIGHT = 0.166; // …and this * height ABOVE the bottom edge
const LEAVE_VERIFY_HALF_W = 0.07; // gold-check box half-width (fraction of width)
const LEAVE_VERIFY_UP = 0.05; // box extends this fraction of height ABOVE the anchor
const LEAVE_VERIFY_DOWN = 0.025; // …and this fraction BELOW (less — avoids the skill bar)
const MIN_LEAVE_GOLD = 12; // min gold samples in the box to confirm the button is there

/** The button's golden/tan text — loose, because it can be dim. Only ever evaluated
 *  inside the small anchor box, which is free of the quest tracker. */
function isLeaveGold(blue: number, green: number, red: number): boolean {
  return red > 140 && green > 105 && blue < 150 && red > blue + 30 && green > blue + 12;
}

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
      // (1) Location anchor.
      const anchorX = Math.round(width - LEAVE_DX_OVER_HEIGHT * height);
      const anchorY = Math.round(height - LEAVE_DY_OVER_HEIGHT * height);
      // (2) Verify the button's gold is actually at the anchor (box clean of quest text).
      const x0 = Math.max(0, Math.round(anchorX - width * LEAVE_VERIFY_HALF_W));
      const x1 = Math.min(width, Math.round(anchorX + width * LEAVE_VERIFY_HALF_W));
      const y0 = Math.max(0, Math.round(anchorY - height * LEAVE_VERIFY_UP));
      const y1 = Math.min(height, Math.round(anchorY + height * LEAVE_VERIFY_DOWN));
      let gold = 0;
      for (let y = y0; y < y1; y += SAMPLE_STRIDE) {
        for (let x = x0; x < x1; x += SAMPLE_STRIDE) {
          const index = (y * width + x) * 4;
          if (isLeaveGold(pixels[index] ?? 0, pixels[index + 1] ?? 0, pixels[index + 2] ?? 0)) {
            gold += 1;
          }
        }
      }
      const verified = gold >= MIN_LEAVE_GOLD;
      if (VISION_DEBUG) {
        console.warn(
          '[vision] leaveHideout',
          JSON.stringify({ anchor: { x: anchorX, y: anchorY }, gold, verified }),
        );
      }
      return verified ? { x: anchorX, y: anchorY } : null;
    },
  };
}
