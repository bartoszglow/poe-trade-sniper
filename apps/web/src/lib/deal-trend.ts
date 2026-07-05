import type { DealBaselineHistoryEntry } from '@poe-sniper/shared';

/**
 * Pure geometry for the DealWatchModal's baseline-trend sparkline (D-dw-12).
 * Takes the API's newest-first history and produces chronological (left→right)
 * pixel-space points, the line/area paths, and the change-since-oldest-shown —
 * the component only renders. Kept out of the component for unit testing.
 */

export interface DealTrendView {
  width: number;
  height: number;
  /** Inner padding so end markers + their surface ring stay inside the box. */
  padding: number;
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
}

/** Round to device-friendly fractions so path strings stay short and stable. */
function roundCoordinate(value: number): number {
  return Math.round(value * 10) / 10;
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

  const innerWidth = view.width - 2 * view.padding;
  const innerHeight = view.height - 2 * view.padding;
  const stepCount = chronological.length - 1;

  const points: DealTrendPoint[] = chronological.map((entry, index) => {
    // Single sample: centered dot. Flat series: a midline (no fake slope).
    const x = stepCount === 0 ? view.width / 2 : view.padding + (index / stepCount) * innerWidth;
    const y =
      amountSpan === 0
        ? view.height / 2
        : view.padding + ((maxAmount - entry.amountExalted) / amountSpan) * innerHeight;
    return {
      x: roundCoordinate(x),
      y: roundCoordinate(y),
      amountExalted: entry.amountExalted,
      computedAt: entry.computedAt,
      rederived: entry.rederived,
    };
  });

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
