import { describe, expect, it } from 'vitest';
import type { SearchLayoutEntry } from '@poe-sniper/shared';
import {
  locateSearch,
  moveRoom,
  moveSearch,
  reorderWithinContainer,
  roomDragId,
  roomDropId,
  roomIdFromDndId,
  topLevelIndexOf,
} from './search-layout-dnd';

const layout: SearchLayoutEntry[] = [
  { kind: 'search', id: 's1' },
  { kind: 'room', id: 'r1', searchIds: ['s2', 's3'] },
  { kind: 'search', id: 's4' },
  { kind: 'room', id: 'r2', searchIds: [] },
];

describe('dnd id helpers', () => {
  it('round-trips room drag/drop ids and rejects search ids', () => {
    expect(roomIdFromDndId(roomDragId('r1'))).toBe('r1');
    expect(roomIdFromDndId(roomDropId('r1'))).toBe('r1');
    expect(roomIdFromDndId('AbCdEf123')).toBeNull();
  });
});

describe('locateSearch / topLevelIndexOf', () => {
  it('locates ungrouped and roomed searches', () => {
    expect(locateSearch(layout, 's1')).toEqual({ roomId: null, index: 0 });
    expect(locateSearch(layout, 's3')).toEqual({ roomId: 'r1', index: 1 });
    expect(locateSearch(layout, 'ghost')).toBeNull();
  });

  it('resolves any target to its top-level slot', () => {
    expect(topLevelIndexOf(layout, 's1')).toBe(0);
    expect(topLevelIndexOf(layout, 's3')).toBe(1); // member → its room's slot
    expect(topLevelIndexOf(layout, roomDragId('r2'))).toBe(3);
    expect(topLevelIndexOf(layout, roomDropId('r1'))).toBe(1);
    expect(topLevelIndexOf(layout, 'ghost')).toBe(-1);
  });
});

describe('moveSearch', () => {
  it('moves an ungrouped search into a room at an index', () => {
    const next = moveSearch(layout, 's1', { roomId: 'r1', index: 1 });
    expect(next).toEqual([
      { kind: 'room', id: 'r1', searchIds: ['s2', 's1', 's3'] },
      { kind: 'search', id: 's4' },
      { kind: 'room', id: 'r2', searchIds: [] },
    ]);
  });

  it('moves a member out to a top-level slot', () => {
    const next = moveSearch(layout, 's2', { roomId: null, index: 2 });
    expect(next).toEqual([
      { kind: 'search', id: 's1' },
      { kind: 'room', id: 'r1', searchIds: ['s3'] },
      { kind: 'search', id: 's2' },
      { kind: 'search', id: 's4' },
      { kind: 'room', id: 'r2', searchIds: [] },
    ]);
  });

  it('moves a member between rooms (into an empty room)', () => {
    const next = moveSearch(layout, 's3', { roomId: 'r2', index: 0 });
    expect(next[1]).toEqual({ kind: 'room', id: 'r1', searchIds: ['s2'] });
    expect(next[3]).toEqual({ kind: 'room', id: 'r2', searchIds: ['s3'] });
  });

  it('clamps an out-of-range index', () => {
    const next = moveSearch(layout, 's1', { roomId: 'r1', index: 99 });
    expect(next[0]).toEqual({ kind: 'room', id: 'r1', searchIds: ['s2', 's3', 's1'] });
  });
});

describe('reorderWithinContainer', () => {
  it('reorders inside a room', () => {
    const next = reorderWithinContainer(layout, 's3', 's2');
    expect(next[1]).toEqual({ kind: 'room', id: 'r1', searchIds: ['s3', 's2'] });
  });

  it('reorders top-level entries', () => {
    const next = reorderWithinContainer(layout, 's1', 's4');
    expect(next.map((entry) => entry.id)).toEqual(['r1', 's4', 's1', 'r2']);
  });

  it('leaves a cross-container pair unchanged (that is moveSearch territory)', () => {
    expect(reorderWithinContainer(layout, 's1', 's3')).toBe(layout);
  });
});

describe('moveRoom', () => {
  it('moves a room block over an ungrouped search', () => {
    const next = moveRoom(layout, 'r2', 's1');
    expect(next.map((entry) => entry.id)).toEqual(['r2', 's1', 'r1', 's4']);
  });

  it("resolves a member target to its room's slot", () => {
    const next = moveRoom(layout, 'r2', 's3');
    expect(next.map((entry) => entry.id)).toEqual(['s1', 'r2', 'r1', 's4']);
  });

  it('is a no-op on an unknown target', () => {
    expect(moveRoom(layout, 'r2', 'ghost')).toBe(layout);
  });
});
