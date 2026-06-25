import { describe, expect, it } from 'vitest';
import type { Listing } from '@poe-sniper/shared';
import type { AppConfig } from '../config/env.js';
import { LiveOfferRegistry } from './live-offer-registry.js';

// The registry only reads SEEN_IDS_CAP; a tiny cap keeps the eviction test readable
// (loadConfig enforces min 100, so we hand-build the slice it actually uses).
const config = { SEEN_IDS_CAP: 3 } as unknown as AppConfig;

function listing(overrides: Partial<Listing> = {}): Listing {
  return {
    listingId: 'a',
    searchId: 's1',
    itemName: 'Chainsting Hunting Spear',
    price: { amount: 1, currency: 'regal' },
    seller: 'Purpitrator#0508',
    hideoutToken: 'tok',
    item: null,
    detectedAt: '2026-06-25T16:02:32.000Z',
    ...overrides,
  };
}

describe('LiveOfferRegistry', () => {
  it('first sighting of an offer is `new`', () => {
    expect(new LiveOfferRegistry(config).ingest(listing())).toBe('new');
  });

  it('the same offer re-served under a NEW id is `updated` (the re-serve bug)', () => {
    const registry = new LiveOfferRegistry(config);
    registry.ingest(listing({ listingId: 'a' }));
    expect(registry.ingest(listing({ listingId: 'b' }))).toBe('updated');
  });

  it('the same offer with the SAME id is `duplicate` (poll re-serve)', () => {
    const registry = new LiveOfferRegistry(config);
    registry.ingest(listing({ listingId: 'a' }));
    expect(registry.ingest(listing({ listingId: 'a' }))).toBe('duplicate');
  });

  it('groups across searches — same offer from another search is not new', () => {
    const registry = new LiveOfferRegistry(config);
    registry.ingest(listing({ listingId: 'a', searchId: 's1' }));
    expect(registry.ingest(listing({ listingId: 'a', searchId: 's2' }))).toBe('duplicate');
  });

  it('keeps distinct offers independent', () => {
    const registry = new LiveOfferRegistry(config);
    registry.ingest(listing({ itemName: 'Spear' }));
    expect(registry.ingest(listing({ listingId: 'z', itemName: 'Sapphire Ring' }))).toBe('new');
  });

  it('evicts the oldest offer beyond the cap', () => {
    const registry = new LiveOfferRegistry(config); // cap 3
    for (const name of ['A', 'B', 'C']) {
      registry.ingest(listing({ listingId: name, itemName: name }));
    }
    registry.ingest(listing({ listingId: 'D', itemName: 'D' })); // evicts the oldest (A)
    expect(registry.ingest(listing({ listingId: 'A2', itemName: 'A' }))).toBe('new');
  });
});
