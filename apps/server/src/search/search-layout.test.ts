import { describe, expect, it } from 'vitest';
import { buildLayout, normalizeLayout } from './search-layout.js';

describe('buildLayout', () => {
  it('groups members onto their room at the first member occurrence', () => {
    const layout = buildLayout(
      [
        { id: 's1', roomId: null },
        { id: 's2', roomId: 'r1' },
        { id: 's3', roomId: 'r1' },
        { id: 's4', roomId: null },
      ],
      [{ id: 'r1', position: 1 }],
    );
    expect(layout).toEqual([
      { kind: 'search', id: 's1' },
      { kind: 'room', id: 'r1', searchIds: ['s2', 's3'] },
      { kind: 'search', id: 's4' },
    ]);
  });

  it('self-heals a non-contiguous membership (e.g. import appended a member at the end)', () => {
    const layout = buildLayout(
      [
        { id: 's1', roomId: 'r1' },
        { id: 's2', roomId: null },
        { id: 's3', roomId: 'r1' },
      ],
      [{ id: 'r1', position: 0 }],
    );
    expect(layout).toEqual([
      { kind: 'room', id: 'r1', searchIds: ['s1', 's3'] },
      { kind: 'search', id: 's2' },
    ]);
  });

  it('splices an empty room back in at its persisted top-level index (clamped)', () => {
    const layout = buildLayout(
      [
        { id: 's1', roomId: null },
        { id: 's2', roomId: null },
      ],
      [
        { id: 'empty-mid', position: 1 },
        { id: 'empty-far', position: 99 },
      ],
    );
    expect(layout).toEqual([
      { kind: 'search', id: 's1' },
      { kind: 'room', id: 'empty-mid', searchIds: [] },
      { kind: 'search', id: 's2' },
      { kind: 'room', id: 'empty-far', searchIds: [] },
    ]);
  });

  it('treats a membership pointing at an unknown room as top-level', () => {
    const layout = buildLayout([{ id: 's1', roomId: 'ghost' }], []);
    expect(layout).toEqual([{ kind: 'search', id: 's1' }]);
  });
});

describe('normalizeLayout', () => {
  const currentSearches = [
    { id: 's1', roomId: null },
    { id: 's2', roomId: 'r1' },
    { id: 's3', roomId: null },
  ];

  it('applies membership from the tree and flattens depth-first', () => {
    const { layout, flattened } = normalizeLayout(
      [
        { kind: 'room', id: 'r1', searchIds: ['s3', 's2'] },
        { kind: 'search', id: 's1' },
      ],
      currentSearches,
      ['r1'],
    );
    expect(layout).toEqual([
      { kind: 'room', id: 'r1', searchIds: ['s3', 's2'] },
      { kind: 'search', id: 's1' },
    ]);
    expect(flattened).toEqual([
      { id: 's3', roomId: 'r1' },
      { id: 's2', roomId: 'r1' },
      { id: 's1', roomId: null },
    ]);
  });

  it('drops unknown and duplicate ids (#29 race rules)', () => {
    const { layout } = normalizeLayout(
      [
        { kind: 'search', id: 'ghost' },
        { kind: 'search', id: 's1' },
        { kind: 'search', id: 's1' },
        { kind: 'room', id: 'r1', searchIds: ['s1', 's2', 'ghost'] },
      ],
      currentSearches,
      ['r1'],
    );
    expect(layout).toEqual([
      { kind: 'search', id: 's1' },
      { kind: 'room', id: 'r1', searchIds: ['s2'] },
      { kind: 'search', id: 's3' },
    ]);
  });

  it("keeps a mid-drag-deleted room's members inline, top-level (release semantics)", () => {
    const { layout } = normalizeLayout(
      [
        { kind: 'room', id: 'deleted-room', searchIds: ['s2', 's3'] },
        { kind: 'search', id: 's1' },
      ],
      currentSearches,
      ['r1'],
    );
    expect(layout).toEqual([
      { kind: 'search', id: 's2' },
      { kind: 'search', id: 's3' },
      { kind: 'search', id: 's1' },
      { kind: 'room', id: 'r1', searchIds: [] },
    ]);
  });

  it('appends the unmentioned: rooms keep their unmentioned members, others go top-level', () => {
    const { layout, flattened } = normalizeLayout([{ kind: 'search', id: 's3' }], currentSearches, [
      'r1',
    ]);
    // s1 (top-level) appended last; s2 follows its still-existing room r1.
    expect(layout).toEqual([
      { kind: 'search', id: 's3' },
      { kind: 'room', id: 'r1', searchIds: ['s2'] },
      { kind: 'search', id: 's1' },
    ]);
    expect(flattened.map((state) => state.id)).toEqual(['s3', 's2', 's1']);
  });
});
