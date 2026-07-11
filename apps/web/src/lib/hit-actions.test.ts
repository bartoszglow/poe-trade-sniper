import { describe, expect, it } from 'vitest';
import { offerKey, type Listing } from '@poe-sniper/shared';
import { HIT_ACTION_MAX_AGE_MS, isHitActionable, retryPayload } from './hit-actions';

function listing(overrides: Partial<Listing> = {}): Listing {
  return {
    listingId: 'l1',
    searchId: 's1',
    itemName: 'Voices',
    price: { amount: 5, currency: 'divine' },
    seller: 'Bob',
    hideoutToken: null,
    item: null,
    detectedAt: '2026-07-11T12:00:00.000Z',
    ...overrides,
  };
}

describe('retryPayload', () => {
  it('carries the identity a server re-resolve keys on (searchId, listingId, offerKey)', () => {
    const source = listing();
    expect(retryPayload(source)).toEqual({
      searchId: 's1',
      listingId: 'l1',
      offerKey: offerKey(source),
    });
  });

  it('pins offerKey to the shared derivation (so a rename cannot drift silently)', () => {
    const source = listing({ seller: 'Alice', price: { amount: 9, currency: 'divine' } });
    expect(retryPayload(source).offerKey).toBe(offerKey(source));
  });
});

describe('isHitActionable', () => {
  const now = new Date('2026-07-11T12:00:00.000Z').getTime();
  const at = (msAgo: number) => new Date(now - msAgo).toISOString();

  it('is actionable for a fresh hit', () => {
    expect(isHitActionable(at(0), now)).toBe(true);
    expect(isHitActionable(at(5 * 60_000), now)).toBe(true);
  });

  it('is actionable right up to the 60-minute boundary (inclusive)', () => {
    expect(isHitActionable(at(HIT_ACTION_MAX_AGE_MS), now)).toBe(true);
  });

  it('is NOT actionable once past the window', () => {
    expect(isHitActionable(at(HIT_ACTION_MAX_AGE_MS + 1), now)).toBe(false);
    expect(isHitActionable(at(2 * 60 * 60_000), now)).toBe(false);
  });

  it('treats a future (clock-skewed) timestamp as actionable', () => {
    expect(isHitActionable(at(-30_000), now)).toBe(true);
  });
});
