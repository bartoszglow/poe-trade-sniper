import type { DealBaselineHistoryEntry } from '@poe-sniper/shared';

/**
 * Pure geometry for the deal baseline-trend chart (D-dw-12).
 * Takes the API's newest-first history and produces chronological (left→right)
 * pixel-space points positioned by REAL sample time (uneven gaps space
 * unevenly), unit-aware integer y-axis ticks over a padded domain, adaptive
 * time-axis ticks, and the change-since-oldest-shown — the component only
 * renders. Kept out of the component for unit testing.
 */

export interface DealTrendView {
  width: number;
  height: number;
  /** Inner padding so end markers + their surface ring stay inside the box. */
  padding: number;
  /**
   * Extra left inset for the y-axis tick labels (full-width chart). The plot
   * area starts at this offset; omitted = `padding` (sparkline behavior).
   */
  paddingLeft?: number;
  /** Extra bottom inset for the time-axis labels; omitted = `padding`. */
  paddingBottom?: number;
}

/** One y-axis gridline: the exalted value, its pixel row, and a ready label. */
export interface DealTrendTick {
  valueExalted: number;
  y: number;
  /** Integer display-unit label ("74 div" / "530 ex") — never decimals. */
  label: string;
}

/** One time-axis tick: epoch ms, its pixel column, and a ready label. */
export interface DealTrendTimeTick {
  ms: number;
  x: number;
  /** "HH:mm" within ~a day and a half, "dd.MM" beyond (see timeTicks). */
  label: string;
}

export interface DealTrendPoint {
  x: number;
  y: number;
  amountExalted: number;
  computedAt: string;
  /** True = this refresh moved the cap (re-derive) — drawn as a marker. */
  rederived: boolean;
}

export interface DealTrendGeometry {
  /** Chronological, oldest first — matches left-to-right reading. */
  points: DealTrendPoint[];
  /** SVG line path (`M … L …`); empty for a single point. */
  pathD: string;
  /** Closed path under the line for the ~10%-opacity wash; empty for a single point. */
  areaD: string;
  /** Newest minus oldest shown, in exalted — the trend label's delta. */
  changeExalted: number;
  oldestComputedAt: string;
  newestComputedAt: string;
  /** Integer display-unit gridlines over the PADDED domain (never empty). */
  ticks: DealTrendTick[];
  /** Adaptive local-wall-clock time ticks (empty for a single sample). */
  timeTicks: DealTrendTimeTick[];
  /** Where the plot area starts/ends on x — gridlines span exactly this range. */
  plotLeft: number;
  plotRight: number;
  /** Bottom edge of the plot area — the time labels render below it. */
  plotBottom: number;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Round to device-friendly fractions so path strings stay short and stable. */
function roundCoordinate(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * The chart's display unit (D-dw-11 magnitude rule): divine when the rate is
 * known and the series peaks at ≥ ~3 div — below that, integer divine ticks
 * could not separate the values — else exalted.
 */
export function trendDisplayUnit(
  maxAmountExalted: number,
  divinePriceExalted: number | null,
): { size: number; suffix: 'div' | 'ex' } {
  if (divinePriceExalted !== null && divinePriceExalted > 0) {
    if (maxAmountExalted >= 3 * divinePriceExalted) {
      return { size: divinePriceExalted, suffix: 'div' };
    }
  }
  return { size: 1, suffix: 'ex' };
}

/**
 * Padded integer domain in DISPLAY units (operator request): a small margin
 * below the min and above the max — max(5% of the span, 0.5 unit), a flat
 * series gets ±1 — then snapped OUTWARD to integers so the integer ticks land
 * on the domain edges cleanly. Never dips below zero (prices).
 */
export function paddedUnitDomain(minUnits: number, maxUnits: number): { lo: number; hi: number } {
  const span = maxUnits - minUnits;
  const pad = span <= 0 ? 1 : Math.max(span * 0.05, 0.5);
  const lo = Math.max(0, Math.floor(minUnits - pad));
  let hi = Math.ceil(maxUnits + pad);
  if (hi <= lo) hi = lo + 1;
  return { lo, hi };
}

/**
 * Integer tick values covering [lo, hi] at a nice whole step (1/2/5×10ⁿ, never
 * below 1) sized for about `target` lines — decimal div ticks read as noise.
 */
export function integerTicks(lo: number, hi: number, target = 4): number[] {
  const span = hi - lo;
  if (span <= 0 || !Number.isFinite(span)) return [];
  const roughStep = span / target;
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(Math.max(roughStep, 1))));
  const residual = roughStep / magnitude;
  const step = Math.max(
    1,
    (residual > 5 ? 10 : residual > 2 ? 5 : residual > 1 ? 2 : 1) * magnitude,
  );
  const ticks: number[] = [];
  for (let value = Math.ceil(lo / step) * step; value <= hi; value += step) {
    ticks.push(value);
  }
  return ticks;
}

/** Group thousands with a narrow space so "26811 ex" reads as "26 811 ex". */
function formatInteger(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function formatClockLabel(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatDayLabel(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** First LOCAL midnight at or after `ms`. */
function nextLocalMidnight(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  if (date.getTime() < ms) date.setDate(date.getDate() + 1);
  return date.getTime();
}

/**
 * Adaptive time-axis ticks on NICE local wall-clock boundaries (operator
 * request): the step scales with the visible range —
 *   ≤ ~36 h  → 15 min…12 h steps, "HH:mm" labels;
 *   ≤ ~8 d   → 1–2-day steps at local midnight, "dd.MM";
 *   longer   → weekly at local midnight, "dd.MM".
 * Pure: everything derives from the two input timestamps.
 */
export function timeTicks(
  startMs: number,
  endMs: number,
  maxTicks = 5,
): Array<{ ms: number; label: string }> {
  const range = endMs - startMs;
  if (!Number.isFinite(range) || range <= 0) return [];

  if (range <= 36 * HOUR_MS) {
    const steps = [15 * MINUTE_MS, 30 * MINUTE_MS, HOUR_MS, 2 * HOUR_MS, 3 * HOUR_MS, 6 * HOUR_MS];
    const step = steps.find((candidate) => range / candidate <= maxTicks) ?? 12 * HOUR_MS;
    // Sub-day boundaries are wall-clock multiples: align in LOCAL time by
    // shifting the epoch grid by the timezone offset (stable within a range
    // this short — a DST edge shifts labels, never breaks them).
    const offsetMs = new Date(startMs).getTimezoneOffset() * MINUTE_MS;
    const first = Math.ceil((startMs - offsetMs) / step) * step + offsetMs;
    const ticks: Array<{ ms: number; label: string }> = [];
    for (let ms = first; ms <= endMs; ms += step) {
      ticks.push({ ms, label: formatClockLabel(ms) });
    }
    // A very short range can straddle no boundary — label the ends instead.
    if (ticks.length === 0) {
      return [
        { ms: startMs, label: formatClockLabel(startMs) },
        { ms: endMs, label: formatClockLabel(endMs) },
      ];
    }
    return ticks;
  }

  const dayStep = range <= 8 * DAY_MS ? (range / DAY_MS <= maxTicks ? 1 : 2) : 7;
  const ticks: Array<{ ms: number; label: string }> = [];
  for (let ms = nextLocalMidnight(startMs); ms <= endMs; ms += dayStep * DAY_MS) {
    // Re-snap to midnight so DST shifts never accumulate across the range.
    const snapped = nextLocalMidnight(ms - HOUR_MS);
    ticks.push({ ms: snapped, label: formatDayLabel(snapped) });
  }
  return ticks;
}

export function buildDealTrendGeometry(
  entriesNewestFirst: DealBaselineHistoryEntry[],
  view: DealTrendView,
  /** Display-only divine rate — picks the tick unit (D-dw-11); null = exalted. */
  divinePriceExalted: number | null = null,
): DealTrendGeometry | null {
  if (entriesNewestFirst.length === 0) return null;
  const chronological = [...entriesNewestFirst].reverse();
  const oldest = chronological[0]!;
  const newest = chronological[chronological.length - 1]!;

  const amounts = chronological.map((entry) => entry.amountExalted);
  const minAmount = Math.min(...amounts);
  const maxAmount = Math.max(...amounts);

  // Padded integer domain in display units (see paddedUnitDomain) — the data
  // never touches the plot edges and every gridline is a whole div/ex value.
  const unit = trendDisplayUnit(maxAmount, divinePriceExalted);
  const domain = paddedUnitDomain(minAmount / unit.size, maxAmount / unit.size);
  const domainLoExalted = domain.lo * unit.size;
  const domainHiExalted = domain.hi * unit.size;
  const domainSpanExalted = domainHiExalted - domainLoExalted;

  const plotLeft = view.paddingLeft ?? view.padding;
  const plotRight = view.width - view.padding;
  const plotBottom = view.height - (view.paddingBottom ?? view.padding);
  const innerWidth = plotRight - plotLeft;
  const innerHeight = plotBottom - view.padding;
  const yForAmount = (amountExalted: number): number =>
    view.padding + ((domainHiExalted - amountExalted) / domainSpanExalted) * innerHeight;

  // Points position by REAL sample time — uneven check gaps space unevenly.
  // Unparsable/degenerate timestamps fall back to even index spacing.
  const timesMs = chronological.map((entry) => Date.parse(entry.computedAt));
  const startMs = timesMs[0]!;
  const endMs = timesMs[timesMs.length - 1]!;
  const timeSpan = endMs - startMs;
  const timeUsable = timesMs.every((ms) => Number.isFinite(ms)) && timeSpan > 0;
  const stepCount = chronological.length - 1;
  const xForIndex = (index: number): number => {
    if (stepCount === 0) return plotLeft + innerWidth / 2;
    if (!timeUsable) return plotLeft + (index / stepCount) * innerWidth;
    return plotLeft + ((timesMs[index]! - startMs) / timeSpan) * innerWidth;
  };

  const points: DealTrendPoint[] = chronological.map((entry, index) => ({
    x: roundCoordinate(xForIndex(index)),
    y: roundCoordinate(yForAmount(entry.amountExalted)),
    amountExalted: entry.amountExalted,
    computedAt: entry.computedAt,
    rederived: entry.rederived,
  }));

  const ticks: DealTrendTick[] = integerTicks(domain.lo, domain.hi).map((unitValue) => ({
    valueExalted: unitValue * unit.size,
    y: roundCoordinate(yForAmount(unitValue * unit.size)),
    label: `${formatInteger(unitValue)} ${unit.suffix}`,
  }));

  const axisTimeTicks: DealTrendTimeTick[] =
    stepCount > 0 && timeUsable
      ? timeTicks(startMs, endMs).map((tick) => ({
          ms: tick.ms,
          x: roundCoordinate(plotLeft + ((tick.ms - startMs) / timeSpan) * innerWidth),
          label: tick.label,
        }))
      : [];

  let pathD = '';
  let areaD = '';
  if (points.length > 1) {
    pathD = points
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`)
      .join(' ');
    const floorY = roundCoordinate(plotBottom);
    const firstPoint = points[0]!;
    const lastPoint = points[points.length - 1]!;
    areaD = `${pathD} L${lastPoint.x} ${floorY} L${firstPoint.x} ${floorY} Z`;
  }

  return {
    points,
    pathD,
    areaD,
    changeExalted: newest.amountExalted - oldest.amountExalted,
    oldestComputedAt: oldest.computedAt,
    newestComputedAt: newest.computedAt,
    ticks,
    timeTicks: axisTimeTicks,
    plotLeft: roundCoordinate(plotLeft),
    plotRight: roundCoordinate(plotRight),
    plotBottom: roundCoordinate(plotBottom),
  };
}

/** Index of the point nearest to an x offset — the hover readout's snap target. */
export function nearestTrendPointIndex(points: DealTrendPoint[], offsetX: number): number | null {
  if (points.length === 0) return null;
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length; index += 1) {
    const distance = Math.abs(points[index]!.x - offsetX);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }
  return nearestIndex;
}
