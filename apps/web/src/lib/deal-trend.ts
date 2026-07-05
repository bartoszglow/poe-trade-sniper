import type { DealBaselineHistoryEntry } from '@poe-sniper/shared';

/**
 * Pure geometry for the deal baseline-trend chart (D-dw-12).
 * Takes the API's newest-first history and produces chronological (left→right)
 * pixel-space points, the line/area paths, and the change-since-oldest-shown —
 * the component only renders. Kept out of the component for unit testing.
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
}

/** One y-axis gridline: a nice round value + its pixel row. */
export interface DealTrendTick {
  valueExalted: number;
  y: number;
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
  /** Recessive y-axis gridlines at nice round values (empty for a flat/single series). */
  ticks: DealTrendTick[];
  /** Where the plot area starts/ends on x — gridlines span exactly this range. */
  plotLeft: number;
  plotRight: number;
}

/** Round to device-friendly fractions so path strings stay short and stable. */
function roundCoordinate(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Nice round tick values covering [min, max] — a 1/2/5×10ⁿ step sized for
 * about `target` lines. Flat spans get no ticks (the midline needs no scale).
 */
export function niceTrendTicks(minValue: number, maxValue: number, target = 3): number[] {
  const span = maxValue - minValue;
  if (span <= 0 || !Number.isFinite(span)) return [];
  const roughStep = span / target;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const residual = roughStep / magnitude;
  const step = (residual >= 5 ? 10 : residual >= 2 ? 5 : residual >= 1 ? 2 : 1) * magnitude;
  const ticks: number[] = [];
  for (let value = Math.ceil(minValue / step) * step; value <= maxValue; value += step) {
    // Snap floating-point drift so labels read clean (74.80000000001 → 74.8).
    ticks.push(Math.round(value / step) * step);
  }
  return ticks;
}

export function buildDealTrendGeometry(
  entriesNewestFirst: DealBaselineHistoryEntry[],
  view: DealTrendView,
): DealTrendGeometry | null {
  if (entriesNewestFirst.length === 0) return null;
  const chronological = [...entriesNewestFirst].reverse();
  const oldest = chronological[0]!;
  const newest = chronological[chronological.length - 1]!;

  const amounts = chronological.map((entry) => entry.amountExalted);
  const minAmount = Math.min(...amounts);
  const maxAmount = Math.max(...amounts);
  const amountSpan = maxAmount - minAmount;

  const plotLeft = view.paddingLeft ?? view.padding;
  const plotRight = view.width - view.padding;
  const innerWidth = plotRight - plotLeft;
  const innerHeight = view.height - 2 * view.padding;
  const stepCount = chronological.length - 1;
  const yForAmount = (amountExalted: number): number =>
    amountSpan === 0
      ? view.height / 2
      : view.padding + ((maxAmount - amountExalted) / amountSpan) * innerHeight;

  const points: DealTrendPoint[] = chronological.map((entry, index) => {
    // Single sample: centered dot. Flat series: a midline (no fake slope).
    const x =
      stepCount === 0 ? plotLeft + innerWidth / 2 : plotLeft + (index / stepCount) * innerWidth;
    return {
      x: roundCoordinate(x),
      y: roundCoordinate(yForAmount(entry.amountExalted)),
      amountExalted: entry.amountExalted,
      computedAt: entry.computedAt,
      rederived: entry.rederived,
    };
  });

  const ticks: DealTrendTick[] = niceTrendTicks(minAmount, maxAmount).map((valueExalted) => ({
    valueExalted,
    y: roundCoordinate(yForAmount(valueExalted)),
  }));

  let pathD = '';
  let areaD = '';
  if (points.length > 1) {
    pathD = points
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x} ${point.y}`)
      .join(' ');
    const floorY = roundCoordinate(view.height - view.padding);
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
    plotLeft: roundCoordinate(plotLeft),
    plotRight: roundCoordinate(plotRight),
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
