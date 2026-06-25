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

/**
 * "MERCHANT" banner: the bright-gold ornate plaque at the top-centre of the shop
 * window. It's ALWAYS present when a shop is open and absent during loading/hideout,
 * so it's a robust, content-independent shop-open signal — the primary one now, with
 * dark-coverage as a fallback. Measured: shop ~2.3% gold coverage in the band, hideout
 * 0%. (Bartosz: "depending on colour is unsafe" — this is a concentrated FIXED UI
 * element, not a content-dependent threshold.)
 */
function isGold(blue: number, green: number, red: number): boolean {
  return red > 150 && green > 120 && blue < 120 && red > blue + 45 && green > blue + 25;
}
// Top-centre band of the shop panel (fractions of the frame) where the plaque sits.
const BANNER_X0 = 0.12;
const BANNER_X1 = 0.42;
const BANNER_Y0 = 0.1;
const BANNER_Y1 = 0.22;
const MIN_BANNER_GOLD_FRACTION = 0.006; // gold coverage in the band to call the banner present

// (Return-to-hideout no longer uses vision: it types the `/hideout` chat command,
//  which needs no button detection — so the old "Leave Hideout" anchor/gold code is
//  gone. Vision is now only the shop-open + item-selection detection below.)

const SAMPLE_STRIDE = 2; // sample every 2nd px (speed)
const CELL = 12; // coarse violet grid cell (px) — bridges the thin/pulsing outline
const MIN_CELL_HITS = 2; // violet samples in a cell to mark it "on"
// A cell counts as the FRAME only if its violet pixels are near-UNIFORM in brightness.
// This is the key discriminator (Bartosz's idea — structure, not a colour threshold):
// the selection frame is one flat UI colour (measured brightness range ~11), while a
// purple ITEM (unique/gem/the lavender creature) is varied art (range 480) — so item
// art drops out and never merges with / outvotes the frame.
const MAX_CELL_BRIGHTNESS_RANGE = 70;
const MIN_CLUSTER_HITS = 18; // total violet samples in the winning cluster
const MAX_BBOX_COVERAGE = 0.85; // reject a cluster spanning ~the whole window (noise)
const TOP_HUD_FRACTION = 0.08; // ignore the top skill/buff HUD strip (steady gem glow)
const MIN_SHOP_DARK_FRACTION = 0.37; // near-black coverage gate (shop ~43% vs ~25-30% elsewhere)

/** Largest non-runaway cluster (below the HUD) of UNIFORM-violet cells → its centre
 *  (frame px), via coarse-grid 8-connected components. The bbox centre of the frame
 *  outline is the highlighted item's centre. Null when no real frame is present. */
function violetClusterCenter(
  cellHits: Int32Array,
  cellMin: Float64Array,
  cellMax: Float64Array,
  cols: number,
  rows: number,
  width: number,
  height: number,
): Point | null {
  const isFrameCell = (cell: number): boolean =>
    (cellHits[cell] ?? 0) >= MIN_CELL_HITS &&
    (cellMax[cell] ?? 0) - (cellMin[cell] ?? 0) <= MAX_CELL_BRIGHTNESS_RANGE;
  const visited = new Uint8Array(cols * rows);
  const stack: number[] = [];
  let best: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
  for (let start = 0; start < cellHits.length; start += 1) {
    if (visited[start] || !isFrameCell(start)) continue;
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
          if (!visited[neighbour] && isFrameCell(neighbour)) {
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
 * Raw-pixel trade vision — ONE strided traversal per frame computes the shop-open
 * signals (the gold MERCHANT banner + near-black coverage) and locates the violet
 * selection frame (no OpenCV / worker / OCR). Two structural ideas keep it robust:
 * the item is the largest cluster of UNIFORM-brightness violet cells (so varied
 * purple item art drops out), and shop-open keys off the fixed banner (so a stray
 * violet glow on the loading screen can't fire — the buy only acts once shopOpen).
 */
export function createRawPixelTradeVision(): TradeVision {
  return {
    analyze(frame: RawFrame): FrameAnalysis {
      const { width, height, pixels } = frame;
      if (width === 0 || height === 0) return { shopOpen: false, item: null };

      const cols = Math.ceil(width / CELL);
      const rows = Math.ceil(height / CELL);
      const cellHits = new Int32Array(cols * rows);
      // Per-cell violet brightness range — the frame's cells are uniform, item art isn't.
      const cellMin = new Float64Array(cols * rows).fill(Infinity);
      const cellMax = new Float64Array(cols * rows);
      let darkHits = 0;
      let samples = 0;
      // "MERCHANT" gold banner, sampled in the top-centre band of the shop panel.
      const bandX0 = width * BANNER_X0;
      const bandX1 = width * BANNER_X1;
      const bandY0 = height * BANNER_Y0;
      const bandY1 = height * BANNER_Y1;
      let bannerGold = 0;
      let bannerSamples = 0;
      for (let y = 0; y < height; y += SAMPLE_STRIDE) {
        const gridY = (y / CELL) | 0;
        const inBandY = y >= bandY0 && y < bandY1;
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
            const brightness = red + green + blue;
            if (brightness < (cellMin[cell] ?? Infinity)) cellMin[cell] = brightness;
            if (brightness > (cellMax[cell] ?? 0)) cellMax[cell] = brightness;
          }
          if (inBandY && x >= bandX0 && x < bandX1) {
            bannerSamples += 1;
            if (isGold(blue, green, red)) bannerGold += 1;
          }
        }
      }

      const darkFraction = samples > 0 ? darkHits / samples : 0;
      const bannerFound =
        bannerSamples > 0 && bannerGold / bannerSamples >= MIN_BANNER_GOLD_FRACTION;
      // Shop-open: the MERCHANT banner (robust, content-independent) is the primary
      // signal; near-black UI coverage stays as a fallback. The item (selection frame)
      // is located regardless, but the buy only acts once shopOpen — so a stray frame on
      // the loading screen can't fire (no banner, low dark there).
      const item = violetClusterCenter(cellHits, cellMin, cellMax, cols, rows, width, height);
      const shopOpen = bannerFound || darkFraction >= MIN_SHOP_DARK_FRACTION;
      if (VISION_DEBUG) {
        console.warn(
          '[vision] analyze',
          JSON.stringify({
            frame: { w: width, h: height },
            darkFraction: +darkFraction.toFixed(3),
            bannerFound,
            shopOpen,
            item,
          }),
        );
      }
      return { shopOpen, item };
    },
  };
}
