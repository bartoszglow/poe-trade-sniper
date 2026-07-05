import { describe, expect, it } from 'vitest';
import type { MarketPriceSnapshot, SearchRuntimeInfo } from '@poe-sniper/shared';
import { formatApproxMarketPrice, marketPriceForListing } from './market-price';

function snapshot(amountExalted: number, divinePriceExalted: number | null): MarketPriceSnapshot {
  return {
    baseline: {
      amountExalted,
      sampleSize: 10,
      rawLowestExalted: amountExalted,
      computedAt: '2026-07-05T12:00:00.000Z',
      listingsSeen: 10,
    },
    divinePriceExalted,
    nextCheckAt: null,
  };
}

describe('formatApproxMarketPrice', () => {
  it('is null without a snapshot', () => {
    expect(formatApproxMarketPrice(null)).toBeNull();
  });

  it('prefixes ~ and renders divine when the amount crosses one divine', () => {
    expect(formatApproxMarketPrice(snapshot(53_421, 714))).toBe('~74.8 div');
  });

  it('stays in exalted (k-rounded) below one divine or without a rate', () => {
    expect(formatApproxMarketPrice(snapshot(1_140, null))).toBe('~1.1k ex');
    expect(formatApproxMarketPrice(snapshot(500, 714))).toBe('~500 ex');
  });
});

describe('marketPriceForListing', () => {
  const searches = [
    { id: 'a', marketPrice: snapshot(700, null) },
    { id: 'b', marketPrice: null },
  ] as unknown as SearchRuntimeInfo[];

  it('resolves the source search snapshot', () => {
    expect(marketPriceForListing('a', searches)?.baseline.amountExalted).toBe(700);
  });

  it('is null for an unknown or snapshot-less search', () => {
    expect(marketPriceForListing('b', searches)).toBeNull();
    expect(marketPriceForListing('zzz', searches)).toBeNull();
  });
});
