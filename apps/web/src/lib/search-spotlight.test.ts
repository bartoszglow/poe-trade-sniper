import { describe, expect, it } from 'vitest';
import {
  SEARCH_HIGHLIGHT_MS,
  isSpotlightFresh,
  readSearchSpotlight,
  spotlightSearch,
} from './search-spotlight';

describe('search spotlight', () => {
  it('holds ONE spotlight — a new click replaces the previous one', () => {
    spotlightSearch('first', 1_000);
    expect(readSearchSpotlight()).toEqual({ searchId: 'first', at: 1_000 });
    spotlightSearch('second', 2_000);
    expect(readSearchSpotlight()).toEqual({ searchId: 'second', at: 2_000 });
  });

  it('re-clicking the same search restarts its window', () => {
    spotlightSearch('same', 1_000);
    spotlightSearch('same', 50_000);
    expect(readSearchSpotlight()).toEqual({ searchId: 'same', at: 50_000 });
  });

  it('ages out after the shared highlight window', () => {
    const spotlight = { searchId: 's1', at: 10_000 };
    expect(isSpotlightFresh(spotlight, 10_000 + SEARCH_HIGHLIGHT_MS - 1)).toBe(true);
    expect(isSpotlightFresh(spotlight, 10_000 + SEARCH_HIGHLIGHT_MS)).toBe(false);
  });
});
