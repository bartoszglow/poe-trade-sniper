import { describe, expect, it } from 'vitest';
import type { Listing } from '@poe-sniper/shared';
import { collapseHit, offerKey, resolveByListingId, type LiveHit } from './live-hits';

function makeListing(overrides: Partial<Listing> = {}): Listing {
  return {
    listingId: 'id-1',
    searchId: 'search-1',
    itemName: 'Chainsting Hunting Spear',
    price: { amount: 1, currency: 'regal' },
    seller: 'Purpitrator#0508',
    hideoutToken: 'tok-1',
    item: null,
    detectedAt: '2026-06-25T16:02:32.000Z',
    ...overrides,
  };
}

describe('offerKey', () => {
  it('is equal for the same item+seller+price across different ids and searches', () => {
    expect(offerKey(makeListing({ listingId: 'a', searchId: 's1' }))).toBe(
      offerKey(makeListing({ listingId: 'b', searchId: 's2' })),
    );
  });

  it('differs when the price differs', () => {
    expect(offerKey(makeListing({ price: { amount: 1, currency: 'regal' } }))).not.toBe(
      offerKey(makeListing({ price: { amount: 2, currency: 'regal' } })),
    );
  });
});

describe('collapseHit', () => {
  it('collapses the same offer served under a new id into one entity (newest id first)', () => {
    const first = collapseHit([], makeListing({ listingId: 'id-1' }), 100);
    const merged = collapseHit(first, makeListing({ listingId: 'id-2' }), 100);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.listingId).toBe('id-2'); // newest used for travel/buy
    expect(merged[0]?.listingIds).toEqual(['id-2', 'id-1']);
  });

  it('keeps distinct offers as separate entities', () => {
    const feed = collapseHit([], makeListing({ listingId: 'id-1' }), 100);
    const next = collapseHit(
      feed,
      makeListing({ listingId: 'id-2', itemName: 'Sapphire Ring' }),
      100,
    );
    expect(next).toHaveLength(2);
  });

  it('does not duplicate the id when the same listing is re-detected', () => {
    const feed = collapseHit([], makeListing({ listingId: 'id-1' }), 100);
    const again = collapseHit(feed, makeListing({ listingId: 'id-1' }), 100);
    expect(again[0]?.listingIds).toEqual(['id-1']);
  });

  it('honours the cap', () => {
    let feed: LiveHit[] = [];
    for (let index = 0; index < 5; index += 1) {
      feed = collapseHit(
        feed,
        makeListing({ listingId: `id-${index}`, itemName: `Item ${index}` }),
        3,
      );
    }
    expect(feed).toHaveLength(3);
  });
});

describe('resolveByListingId', () => {
  it('finds state recorded under an older id of the entity', () => {
    const travelState = { 'id-1': { phase: 'success' as const, detail: null } };
    // entity now keyed newest-first; the travel happened under the older id-1
    expect(resolveByListingId(travelState, ['id-2', 'id-1'])?.phase).toBe('success');
  });

  it('returns undefined when no id has state', () => {
    expect(resolveByListingId<{ phase: string }>({}, ['id-2', 'id-1'])).toBeUndefined();
  });
});
