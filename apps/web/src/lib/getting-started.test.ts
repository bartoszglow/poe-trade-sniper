import { describe, expect, it } from 'vitest';
import { deriveGettingStarted } from './getting-started';

describe('deriveGettingStarted', () => {
  it('fresh install: nothing done', () => {
    expect(
      deriveGettingStarted({ hasValidSession: false, searchCount: 0, firstHitReceived: false }),
    ).toEqual({
      sessionConnected: false,
      firstSearchAdded: false,
      firstHitReceived: false,
      allDone: false,
    });
  });

  it('progresses step by step', () => {
    expect(
      deriveGettingStarted({ hasValidSession: true, searchCount: 0, firstHitReceived: false }),
    ).toMatchObject({ sessionConnected: true, firstSearchAdded: false, allDone: false });
    expect(
      deriveGettingStarted({ hasValidSession: true, searchCount: 2, firstHitReceived: false }),
    ).toMatchObject({ firstSearchAdded: true, firstHitReceived: false, allDone: false });
  });

  it('stays complete on the durable hit signal even if searches were pruned', () => {
    // firstHitReceived is the durable server flag, NOT a live sum — so searchCount
    // dropping back does not regress the (separate) hit step.
    expect(
      deriveGettingStarted({ hasValidSession: true, searchCount: 1, firstHitReceived: true }),
    ).toMatchObject({ allDone: true });
  });
});
