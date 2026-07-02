import { describe, expect, it } from 'vitest';
import { deriveGettingStarted } from './getting-started';

describe('deriveGettingStarted', () => {
  it('fresh install: nothing done', () => {
    expect(
      deriveGettingStarted({ hasValidSession: false, searchCount: 0, totalHitCount: 0 }),
    ).toEqual({
      sessionConnected: false,
      firstSearchAdded: false,
      firstHitReceived: false,
      allDone: false,
    });
  });

  it('progresses step by step', () => {
    expect(
      deriveGettingStarted({ hasValidSession: true, searchCount: 0, totalHitCount: 0 }),
    ).toMatchObject({ sessionConnected: true, firstSearchAdded: false, allDone: false });
    expect(
      deriveGettingStarted({ hasValidSession: true, searchCount: 2, totalHitCount: 0 }),
    ).toMatchObject({ firstSearchAdded: true, firstHitReceived: false, allDone: false });
  });

  it('completes when all three funnel steps happened', () => {
    expect(
      deriveGettingStarted({ hasValidSession: true, searchCount: 1, totalHitCount: 5 }),
    ).toMatchObject({ allDone: true });
  });
});
