import { describe, expect, it } from 'vitest';
import { parseMarketPriceSnapshot } from './market-price-snapshot.schema.js';

const VALID = {
  baseline: {
    amountExalted: 500,
    sampleSize: 5,
    rawLowestExalted: 480,
    computedAt: '2026-07-05T10:00:00Z',
    listingsSeen: 10,
  },
  divinePriceExalted: 714.3,
  nextCheckAt: '2026-07-05T11:00:00Z',
};

describe('parseMarketPriceSnapshot', () => {
  it('round-trips a valid persisted snapshot', () => {
    expect(parseMarketPriceSnapshot(VALID)).toEqual(VALID);
  });

  it('null/undefined column reads as null', () => {
    expect(parseMarketPriceSnapshot(null)).toBeNull();
    expect(parseMarketPriceSnapshot(undefined)).toBeNull();
  });

  it('malformed JSON degrades to null instead of throwing into the boot path', () => {
    expect(parseMarketPriceSnapshot({ baseline: null })).toBeNull();
    expect(parseMarketPriceSnapshot({ ...VALID, baseline: { amountExalted: 'x' } })).toBeNull();
    expect(parseMarketPriceSnapshot('garbage')).toBeNull();
  });
});
