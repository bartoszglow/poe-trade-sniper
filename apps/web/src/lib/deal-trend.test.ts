import { describe, expect, it } from 'vitest';
import type { DealBaselineHistoryEntry } from '@poe-sniper/shared';
import {
  buildDealTrendGeometry,
  integerTicks,
  nearestTrendPointIndex,
  paddedUnitDomain,
  timeTicks,
  trendDisplayUnit,
} from './deal-trend';

// plotLeft 10, plotRight 90, plotBottom 40 (paddingBottom defaults to padding).
const VIEW = { width: 100, height: 50, padding: 10 };

const T0 = Date.parse('2026-07-05T10:00:00.000Z');
const HOUR = 3_600_000;

function isoAt(offsetMs: number): string {
  return new Date(T0 + offsetMs).toISOString();
}

function entry(overrides: Partial<DealBaselineHistoryEntry>): DealBaselineHistoryEntry {
  return {
    amountExalted: 100,
    rawLowestExalted: 90,
    sampleSize: 5,
    rederived: false,
    computedAt: isoAt(0),
    ...overrides,
  };
}

describe('buildDealTrendGeometry', () => {
  it('returns null for an empty history', () => {
    expect(buildDealTrendGeometry([], VIEW)).toBeNull();
  });

  it('reverses the newest-first API order into chronological points', () => {
    const geometry = buildDealTrendGeometry(
      [
        entry({ amountExalted: 300, computedAt: isoAt(2 * HOUR) }), // newest
        entry({ amountExalted: 200, computedAt: isoAt(HOUR) }),
        entry({ amountExalted: 100, computedAt: isoAt(0) }), // oldest
      ],
      VIEW,
    );
    expect(geometry).not.toBeNull();
    expect(geometry!.points.map((point) => point.amountExalted)).toEqual([100, 200, 300]);
    expect(geometry!.oldestComputedAt).toBe(isoAt(0));
    expect(geometry!.newestComputedAt).toBe(isoAt(2 * HOUR));
    expect(geometry!.changeExalted).toBe(200);
  });

  it('positions points by REAL sample time — uneven gaps space unevenly', () => {
    const geometry = buildDealTrendGeometry(
      [
        entry({ computedAt: isoAt(4 * HOUR) }), // newest
        entry({ computedAt: isoAt(HOUR) }),
        entry({ computedAt: isoAt(0) }), // oldest
      ],
      VIEW,
    )!;
    // 4h span over 80px: 0h → 10, 1h → 30, 4h → 90.
    expect(geometry.points.map((point) => point.x)).toEqual([10, 30, 90]);
  });

  it('falls back to even index spacing when timestamps are unusable', () => {
    const sameInstant = isoAt(0);
    const geometry = buildDealTrendGeometry(
      [
        entry({ computedAt: sameInstant }),
        entry({ computedAt: sameInstant }),
        entry({ computedAt: sameInstant }),
      ],
      VIEW,
    )!;
    expect(geometry.points.map((point) => point.x)).toEqual([10, 50, 90]);
    expect(geometry.timeTicks).toEqual([]);
  });

  it('pads the domain so no point touches the plot edges', () => {
    const geometry = buildDealTrendGeometry(
      [
        entry({ amountExalted: 300, computedAt: isoAt(HOUR) }),
        entry({ amountExalted: 100, computedAt: isoAt(0) }),
      ],
      VIEW,
    )!;
    for (const point of geometry.points) {
      expect(point.y).toBeGreaterThan(VIEW.padding);
      expect(point.y).toBeLessThan(40); // plotBottom
    }
  });

  it('gives a flat series a visible ±1-unit band instead of a degenerate domain', () => {
    const geometry = buildDealTrendGeometry(
      [
        entry({ amountExalted: 100, computedAt: isoAt(HOUR) }),
        entry({ amountExalted: 100, computedAt: isoAt(0) }),
      ],
      VIEW,
    )!;
    // Domain 99..101 → the flat line sits mid-plot; ticks exist (99/100/101).
    expect(geometry.points.every((point) => point.y === 25)).toBe(true);
    expect(geometry.ticks.map((tick) => tick.valueExalted)).toEqual([99, 100, 101]);
    expect(geometry.changeExalted).toBe(0);
  });

  it('renders a single sample as one centered dot with no paths and no time axis', () => {
    const geometry = buildDealTrendGeometry([entry({ amountExalted: 100 })], VIEW)!;
    expect(geometry.points).toHaveLength(1);
    expect(geometry.points[0]).toMatchObject({ x: 50, y: 25 });
    expect(geometry.pathD).toBe('');
    expect(geometry.areaD).toBe('');
    expect(geometry.timeTicks).toEqual([]);
  });

  it('closes the area path on the plot bottom, not the box bottom', () => {
    const geometry = buildDealTrendGeometry(
      [
        entry({ amountExalted: 300, computedAt: isoAt(HOUR) }),
        entry({ amountExalted: 100, computedAt: isoAt(0) }),
      ],
      { ...VIEW, paddingBottom: 20 },
    )!;
    expect(geometry.plotBottom).toBe(30);
    expect(geometry.areaD.endsWith('L10 30 Z')).toBe(true);
  });

  it('carries the rederived flag through to the points', () => {
    const geometry = buildDealTrendGeometry(
      [
        entry({ amountExalted: 300, rederived: true, computedAt: isoAt(2 * HOUR) }),
        entry({ amountExalted: 200, computedAt: isoAt(HOUR) }),
        entry({ amountExalted: 100, rederived: true, computedAt: isoAt(0) }),
      ],
      VIEW,
    )!;
    expect(geometry.points.map((point) => point.rederived)).toEqual([true, false, true]);
  });

  it('starts the plot at paddingLeft when the label inset is used', () => {
    const geometry = buildDealTrendGeometry(
      [
        entry({ amountExalted: 300, computedAt: isoAt(HOUR) }),
        entry({ amountExalted: 100, computedAt: isoAt(0) }),
      ],
      { ...VIEW, paddingLeft: 40 },
    )!;
    expect(geometry.plotLeft).toBe(40);
    expect(geometry.points[0]!.x).toBe(40);
    expect(geometry.points[1]!.x).toBe(VIEW.width - VIEW.padding);
  });
});

describe('y-axis unit + ticks (integer div/ex, operator request)', () => {
  it('labels ticks in whole divine when the rate is known and values are large', () => {
    const rate = 700;
    const geometry = buildDealTrendGeometry(
      [
        entry({ amountExalted: 27_400, computedAt: isoAt(HOUR) }), // ~39.1 div
        entry({ amountExalted: 26_800, computedAt: isoAt(0) }), // ~38.3 div
      ],
      VIEW,
      rate,
    )!;
    expect(geometry.ticks.length).toBeGreaterThanOrEqual(3);
    for (const tick of geometry.ticks) {
      expect(tick.label).toMatch(/^\d+( \d{3})* div$/); // integers only, no decimals
      expect(tick.valueExalted % rate).toBe(0);
    }
  });

  it('falls back to integer exalted ticks for small values or an unknown rate', () => {
    const small = buildDealTrendGeometry(
      [
        entry({ amountExalted: 1_500, computedAt: isoAt(HOUR) }), // ~2.1 div — too small
        entry({ amountExalted: 1_400, computedAt: isoAt(0) }),
      ],
      VIEW,
      700,
    )!;
    expect(small.ticks.every((tick) => tick.label.endsWith(' ex'))).toBe(true);
    const rateless = buildDealTrendGeometry(
      [
        entry({ amountExalted: 300, computedAt: isoAt(HOUR) }),
        entry({ amountExalted: 100, computedAt: isoAt(0) }),
      ],
      VIEW,
      null,
    )!;
    expect(rateless.ticks.every((tick) => tick.label.endsWith(' ex'))).toBe(true);
  });

  it('trendDisplayUnit picks divine only above ~3 div with a valid rate', () => {
    expect(trendDisplayUnit(26_811, 714)).toEqual({ size: 714, suffix: 'div' });
    expect(trendDisplayUnit(1_500, 714)).toEqual({ size: 1, suffix: 'ex' });
    expect(trendDisplayUnit(26_811, null)).toEqual({ size: 1, suffix: 'ex' });
    expect(trendDisplayUnit(26_811, 0)).toEqual({ size: 1, suffix: 'ex' });
  });

  it('paddedUnitDomain adds a snapped-outward margin and never dips below zero', () => {
    expect(paddedUnitDomain(71.1, 74.8)).toEqual({ lo: 70, hi: 76 });
    expect(paddedUnitDomain(39, 39)).toEqual({ lo: 38, hi: 40 }); // flat → ±1
    expect(paddedUnitDomain(0.2, 0.4)).toEqual({ lo: 0, hi: 1 });
  });

  it('integerTicks uses whole 1/2/5-style steps, never below 1', () => {
    expect(integerTicks(70, 76)).toEqual([70, 72, 74, 76]);
    expect(integerTicks(38, 40)).toEqual([38, 39, 40]);
    expect(integerTicks(0, 310)).toEqual([0, 100, 200, 300]);
    expect(integerTicks(5, 5)).toEqual([]);
  });
});

describe('timeTicks (adaptive local wall-clock scale)', () => {
  it('uses HH:mm labels on clean sub-hour boundaries for short ranges', () => {
    const ticks = timeTicks(T0, T0 + 2 * HOUR);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks.length).toBeLessThanOrEqual(5);
    for (const tick of ticks) {
      expect(tick.label).toMatch(/^\d{2}:\d{2}$/);
      expect(tick.ms).toBeGreaterThanOrEqual(T0);
      expect(tick.ms).toBeLessThanOrEqual(T0 + 2 * HOUR);
      expect([0, 15, 30, 45]).toContain(new Date(tick.ms).getMinutes());
    }
  });

  it('labels the range ends when no boundary falls inside a tiny range', () => {
    const start = T0 + 7 * 60_000; // 7 minutes past — no 15-min boundary inside
    const ticks = timeTicks(start, start + 6 * 60_000);
    expect(ticks).toHaveLength(2);
    expect(ticks[0]!.ms).toBe(start);
    expect(ticks[1]!.ms).toBe(start + 6 * 60_000);
  });

  it('switches to dd.MM day boundaries for multi-day ranges', () => {
    const ticks = timeTicks(T0, T0 + 3 * 24 * HOUR);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    for (const tick of ticks) {
      expect(tick.label).toMatch(/^\d{2}\.\d{2}$/);
      expect(new Date(tick.ms).getHours()).toBe(0); // local midnight
    }
  });

  it('spaces weekly for month-scale ranges', () => {
    const ticks = timeTicks(T0, T0 + 30 * 24 * HOUR);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks.length).toBeLessThanOrEqual(6);
    for (const tick of ticks) expect(tick.label).toMatch(/^\d{2}\.\d{2}$/);
  });

  it('returns nothing for a degenerate range', () => {
    expect(timeTicks(T0, T0)).toEqual([]);
    expect(timeTicks(T0, T0 - HOUR)).toEqual([]);
  });
});

describe('nearestTrendPointIndex', () => {
  it('snaps an x offset to the closest point', () => {
    const geometry = buildDealTrendGeometry(
      [
        entry({ amountExalted: 300, computedAt: isoAt(2 * HOUR) }),
        entry({ amountExalted: 200, computedAt: isoAt(HOUR) }),
        entry({ amountExalted: 100, computedAt: isoAt(0) }),
      ],
      VIEW,
    )!;
    expect(nearestTrendPointIndex(geometry.points, 0)).toBe(0);
    expect(nearestTrendPointIndex(geometry.points, 51)).toBe(1);
    expect(nearestTrendPointIndex(geometry.points, 95)).toBe(2);
  });

  it('returns null with no points', () => {
    expect(nearestTrendPointIndex([], 10)).toBeNull();
  });
});
