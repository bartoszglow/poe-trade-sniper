import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isWithinSyntheticGrace, markSyntheticMove } from './synthetic-input-marker.js';

describe('synthetic-input marker (O-7 self-abort guard)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is within grace right after a synthetic move, and outside once the window passes', () => {
    markSyntheticMove();
    expect(isWithinSyntheticGrace(100)).toBe(true);
    vi.advanceTimersByTime(50);
    expect(isWithinSyntheticGrace(100)).toBe(true); // 50ms < 100ms — still ours
    vi.advanceTimersByTime(100);
    expect(isWithinSyntheticGrace(100)).toBe(false); // 150ms > 100ms — treat as the user
  });
});
