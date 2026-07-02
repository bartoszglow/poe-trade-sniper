import { describe, expect, it } from 'vitest';
import {
  isRoomVisuallyCollapsed,
  pruneSuppressedRooms,
  readSuppressedRoomIds,
  suppressRoomAutoExpand,
  writeSuppressedRoomIds,
} from './room-auto-expand';

describe('isRoomVisuallyCollapsed', () => {
  it('a persistently expanded room is never collapsed by the highlight machinery', () => {
    expect(
      isRoomVisuallyCollapsed({ persistedCollapsed: false, hasFreshHit: true, suppressed: false }),
    ).toBe(false);
    expect(
      isRoomVisuallyCollapsed({ persistedCollapsed: false, hasFreshHit: false, suppressed: true }),
    ).toBe(false);
  });

  it('a collapsed room auto-expands while a member hit is fresh', () => {
    expect(
      isRoomVisuallyCollapsed({ persistedCollapsed: true, hasFreshHit: true, suppressed: false }),
    ).toBe(false);
  });

  it('folds back once the window ages out', () => {
    expect(
      isRoomVisuallyCollapsed({ persistedCollapsed: true, hasFreshHit: false, suppressed: false }),
    ).toBe(true);
  });

  it('stays collapsed when the operator suppressed it mid-window', () => {
    expect(
      isRoomVisuallyCollapsed({ persistedCollapsed: true, hasFreshHit: true, suppressed: true }),
    ).toBe(true);
  });
});

describe('pruneSuppressedRooms', () => {
  it('returns null while every suppressed room still has a fresh window', () => {
    expect(pruneSuppressedRooms(new Set(['r1']), new Set(['r1', 'r2']))).toBeNull();
    expect(pruneSuppressedRooms(new Set(), new Set(['r1']))).toBeNull();
  });

  it('drops rooms whose window expired (a fresh NEW hit may auto-expand again)', () => {
    const pruned = pruneSuppressedRooms(new Set(['r1', 'r2']), new Set(['r2']));
    expect(pruned).toEqual(new Set(['r2']));
  });

  it('drops a suppressed room that no longer exists (its id is simply not fresh)', () => {
    expect(pruneSuppressedRooms(new Set(['ghost']), new Set())).toEqual(new Set());
  });
});

describe('session suppression store', () => {
  it('survives a page remount round-trip (read after suppress) and syncs prunes back', () => {
    writeSuppressedRoomIds(new Set());
    expect(readSuppressedRoomIds()).toEqual(new Set());

    const afterSuppress = suppressRoomAutoExpand('r1');
    expect(afterSuppress).toEqual(new Set(['r1']));
    // A remounting page reads the same set back — no useState amnesia.
    expect(readSuppressedRoomIds()).toEqual(new Set(['r1']));

    writeSuppressedRoomIds(new Set()); // window expired → prune synced back
    expect(readSuppressedRoomIds()).toEqual(new Set());
  });
});
