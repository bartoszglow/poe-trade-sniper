import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isWithinSyntheticGrace,
  isWithinSyntheticKeyGrace,
  markSyntheticKey,
  markSyntheticMove,
} from './synthetic-input-marker.js';

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

  it('tracks the KEY grace separately from moves (Esc/Enter/typed chars)', () => {
    markSyntheticKey();
    expect(isWithinSyntheticKeyGrace(100)).toBe(true);
    vi.advanceTimersByTime(150);
    expect(isWithinSyntheticKeyGrace(100)).toBe(false);
  });

  it('a synthetic MOVE does not refresh the KEY grace (a real keypress mid-placement still aborts)', () => {
    markSyntheticKey();
    vi.advanceTimersByTime(200); // key grace (100ms) has expired
    markSyntheticMove(); // a synthetic move now must NOT revive the key grace
    expect(isWithinSyntheticKeyGrace(100)).toBe(false);
    expect(isWithinSyntheticGrace(100)).toBe(true); // …but the move itself is graced
  });
});
