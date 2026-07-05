import { describe, expect, it } from 'vitest';
import type { DealBaselineHistoryEntry } from '@poe-sniper/shared';
import { buildDealTrendGeometry, nearestTrendPointIndex } from './deal-trend';

const VIEW = { width: 100, height: 50, padding: 10 };

function entry(overrides: Partial<DealBaselineHistoryEntry>): DealBaselineHistoryEntry {
  return {
    amountExalted: 100,
    rawLowestExalted: 90,
    sampleSize: 5,
    rederived: false,
    computedAt: '2026-07-05T12:00:00.000Z',
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
        entry({ amountExalted: 300, computedAt: '2026-07-05T12:00:00.000Z' }), // newest
        entry({ amountExalted: 200, computedAt: '2026-07-05T11:00:00.000Z' }),
        entry({ amountExalted: 100, computedAt: '2026-07-05T10:00:00.000Z' }), // oldest
      ],
      VIEW,
    );
    expect(geometry).not.toBeNull();
    expect(geometry!.points.map((point) => point.amountExalted)).toEqual([100, 200, 300]);
    expect(geometry!.oldestComputedAt).toBe('2026-07-05T10:00:00.000Z');
    expect(geometry!.newestComputedAt).toBe('2026-07-05T12:00:00.000Z');
    expect(geometry!.changeExalted).toBe(200);
  });

  it('maps the max to the top padding and the min to the bottom padding', () => {
    const geometry = buildDealTrendGeometry(
      [entry({ amountExalted: 300 }), entry({ amountExalted: 100 })],
      VIEW,
    )!;
    // Chronological: 100 (oldest, left, bottom) then 300 (newest, right, top).
    expect(geometry.points[0]).toMatchObject({ x: 10, y: 40 });
    expect(geometry.points[1]).toMatchObject({ x: 90, y: 10 });
    expect(geometry.pathD).toBe('M10 40 L90 10');
    expect(geometry.areaD).toBe('M10 40 L90 10 L90 40 L10 40 Z');
  });

  it('draws a flat series as a midline, not a fake slope', () => {
    const geometry = buildDealTrendGeometry(
      [entry({ amountExalted: 100 }), entry({ amountExalted: 100 })],
      VIEW,
    )!;
    expect(geometry.points.every((point) => point.y === 25)).toBe(true);
    expect(geometry.changeExalted).toBe(0);
  });

  it('renders a single sample as one centered dot with no paths', () => {
    const geometry = buildDealTrendGeometry([entry({ amountExalted: 100 })], VIEW)!;
    expect(geometry.points).toHaveLength(1);
    expect(geometry.points[0]).toMatchObject({ x: 50, y: 25 });
    expect(geometry.pathD).toBe('');
    expect(geometry.areaD).toBe('');
    expect(geometry.changeExalted).toBe(0);
  });

  it('carries the rederived flag through to the points', () => {
    const geometry = buildDealTrendGeometry(
      [
        entry({ amountExalted: 300, rederived: true }),
        entry({ amountExalted: 200 }),
        entry({ amountExalted: 100, rederived: true }),
      ],
      VIEW,
    )!;
    expect(geometry.points.map((point) => point.rederived)).toEqual([true, false, true]);
  });
});

describe('nearestTrendPointIndex', () => {
  it('snaps an x offset to the closest point', () => {
    const geometry = buildDealTrendGeometry(
      [entry({ amountExalted: 300 }), entry({ amountExalted: 200 }), entry({ amountExalted: 100 })],
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
