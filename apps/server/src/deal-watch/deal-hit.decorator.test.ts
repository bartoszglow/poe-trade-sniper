import { describe, expect, it } from 'vitest';
import type { DealWatchState, Listing, ManagedSearch } from '@poe-sniper/shared';
import { DealHitDecorator, type DealRuntimeSnapshot } from './deal-hit.decorator.js';

const STALE_MS = 3 * 60 * 60 * 1000;
const NOW = Date.parse('2026-07-05T12:00:00.000Z');

function dealState(overrides: Partial<DealWatchState> = {}): DealWatchState {
  return {
    watchId: 'w1',
    mode: 'percent',
    thresholdValue: 30,
    unit: 'exalted',
    baselineSampleSize: 10,
    definition: {},
    originalSearchId: 'orig',
    originalPriceFilter: null,
    baseline: {
      amountExalted: 1000,
      sampleSize: 5,
      rawLowestExalted: 950,
      computedAt: '2026-07-05T11:30:00.000Z',
      listingsSeen: 8,
    },
    capBaseline: null,
    capExalted: 700,
    derivedCreatedAt: '2026-07-05T11:30:00.000Z',
    status: 'active',
    nextRefreshAt: null,
    divinePriceExalted: null,
    ...overrides,
  };
}

function makeListing(price: Listing['price']): Listing {
  return {
    listingId: 'l1',
    searchId: 'deal1234',
    itemName: 'Headhunter',
    price,
    seller: 'seller#1',
    hideoutToken: null,
    item: null,
    detectedAt: '2026-07-05T12:00:00.000Z',
  };
}

function makeDecorator(options: {
  state?: DealWatchState | null;
  snapshot?: DealRuntimeSnapshot | null;
}) {
  const row = {
    id: 'deal1234',
    dealWatch: options.state === undefined ? dealState() : options.state,
  } as ManagedSearch;
  return new DealHitDecorator(
    (searchId) => (searchId === 'deal1234' ? row : null),
    () =>
      options.snapshot === undefined
        ? { ratesByApiId: new Map([['divine', 700]]), divinePriceExalted: 700, cutoffExalted: 700 }
        : options.snapshot,
    STALE_MS,
    () => NOW,
  );
}

describe('DealHitDecorator', () => {
  it('ignores ordinary searches', () => {
    const decorator = makeDecorator({ state: null });
    expect(decorator.decorate(makeListing({ amount: 1, currency: 'divine' }))).toBeNull();
  });

  it('treats a pre-derive deal row as an ordinary search (original query watched)', () => {
    const decorator = makeDecorator({ state: dealState({ derivedCreatedAt: null }) });
    expect(decorator.decorate(makeListing({ amount: 1, currency: 'divine' }))).toBeNull();
  });

  it('emits a deal with discount math for an under-cutoff listing', () => {
    const decorator = makeDecorator({});
    const decoration = decorator.decorate(makeListing({ amount: 650, currency: 'exalted' }));
    expect(decoration).not.toBeNull();
    expect(decoration?.suppressAlert).toBe(false);
    expect(decoration?.event.type).toBe('deal');
    expect(decoration?.updatedEvent.type).toBe('deal-updated');
    const deal = decoration?.hitColumns?.deal as {
      baselineExalted: number;
      discountPercent: number;
      discountExalted: number;
      baselineStale: boolean;
    };
    expect(deal.baselineExalted).toBe(1000);
    expect(deal.discountPercent).toBeCloseTo(35);
    expect(deal.discountExalted).toBe(350);
    expect(deal.baselineStale).toBe(false);
  });

  it('converts non-exalted prices through the rate snapshot', () => {
    const decorator = makeDecorator({});
    // 0.9 divine × 700 = 630 exalted → 37% below the 1000 baseline.
    const decoration = decorator.decorate(makeListing({ amount: 0.9, currency: 'divine' }));
    const deal = decoration?.hitColumns?.deal as { discountPercent: number };
    expect(deal.discountPercent).toBeCloseTo(37);
  });

  it('suppresses a priced listing above the live cutoff (persisted, silent)', () => {
    const decorator = makeDecorator({});
    const decoration = decorator.decorate(makeListing({ amount: 800, currency: 'exalted' }));
    expect(decoration?.suppressAlert).toBe(true);
    expect(decoration?.hitColumns?.deal).toBeTruthy();
  });

  it('never suppresses an unpriceable listing — null discounts, alert fires', () => {
    const decorator = makeDecorator({});
    const decoration = decorator.decorate(makeListing({ amount: 99, currency: 'waystone-10' }));
    expect(decoration?.suppressAlert).toBe(false);
    const deal = decoration?.hitColumns?.deal as { discountPercent: number | null };
    expect(deal.discountPercent).toBeNull();
  });

  it('flags a stale baseline by age even when the status has not caught up', () => {
    const staleComputedAt = new Date(NOW - STALE_MS - 60_000).toISOString();
    const decorator = makeDecorator({
      state: dealState({
        baseline: {
          amountExalted: 1000,
          sampleSize: 5,
          rawLowestExalted: 950,
          computedAt: staleComputedAt,
          listingsSeen: 8,
        },
      }),
    });
    const decoration = decorator.decorate(makeListing({ amount: 650, currency: 'exalted' }));
    const deal = decoration?.hitColumns?.deal as { baselineStale: boolean };
    expect(deal.baselineStale).toBe(true);
  });

  it('emits a deal with null fields when no baseline exists yet (never a bare hit)', () => {
    const decorator = makeDecorator({
      state: dealState({ baseline: null }),
      snapshot: { ratesByApiId: null, divinePriceExalted: null, cutoffExalted: null },
    });
    const decoration = decorator.decorate(makeListing({ amount: 650, currency: 'exalted' }));
    expect(decoration).not.toBeNull();
    expect(decoration?.suppressAlert).toBe(false);
    const deal = decoration?.hitColumns?.deal as { baselineExalted: null };
    expect(deal.baselineExalted).toBeNull();
  });
});
