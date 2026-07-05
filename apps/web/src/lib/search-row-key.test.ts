import { describe, expect, it } from 'vitest';
import { duplicatedAddedAts, stableRowKey } from './search-row-key';

const DEAL = { watchId: 'watch-1' };

describe('stableRowKey', () => {
  it('keys by addedAt so deal enable/disable and re-points never remount the row', () => {
    const duplicated = new Set<string>();
    const before = stableRowKey(
      { id: 'oldId', addedAt: '2026-07-05T10:00:00.000Z', dealWatch: null },
      duplicated,
    );
    const afterEnable = stableRowKey(
      { id: 'newDerivedId', addedAt: '2026-07-05T10:00:00.000Z', dealWatch: DEAL },
      duplicated,
    );
    const afterRepoint = stableRowKey(
      { id: 'repointedId', addedAt: '2026-07-05T10:00:00.000Z', dealWatch: null },
      duplicated,
    );
    expect(afterEnable).toBe(before);
    expect(afterRepoint).toBe(before);
  });

  it('tie-breaks duplicate timestamps deterministically (import artifacts)', () => {
    const searches = [
      { id: 'a', addedAt: 'T1', dealWatch: null },
      { id: 'b', addedAt: 'T1', dealWatch: DEAL },
      { id: 'c', addedAt: 'T2', dealWatch: null },
    ];
    const duplicated = duplicatedAddedAts(searches);
    expect(duplicated).toEqual(new Set(['T1']));
    const keys = searches.map((search) => stableRowKey(search, duplicated));
    expect(new Set(keys).size).toBe(3);
    expect(keys[2]).toBe('T2');
  });
});
