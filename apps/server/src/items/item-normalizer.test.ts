import { describe, expect, it } from 'vitest';
import { cleanMarkup, normalizeItemDetail, normalizeListing } from './item-normalizer.js';

describe('cleanMarkup', () => {
  it('replaces [tag|display] with the display text', () => {
    expect(cleanMarkup('+35% to [Resistances|Lightning Resistance]')).toBe(
      '+35% to Lightning Resistance',
    );
  });

  it('replaces bare [tag] with the tag itself', () => {
    expect(cleanMarkup('Causes [Bleeding] on hit')).toBe('Causes Bleeding on hit');
  });

  it('handles multiple tags in one line', () => {
    expect(cleanMarkup('[Bleeding] and [Resistances|Fire Resistance]')).toBe(
      'Bleeding and Fire Resistance',
    );
  });

  it('leaves plain text untouched', () => {
    expect(cleanMarkup('+50 to maximum Life')).toBe('+50 to maximum Life');
  });
});

describe('normalizeItemDetail', () => {
  const rawItem = {
    name: 'Storm Veil',
    typeLine: 'Vile Robe',
    baseType: 'Vile Robe',
    rarity: 'Rare',
    ilvl: 81,
    corrupted: true,
    properties: [{ name: '[EnergyShield|Energy Shield]', values: [['412', 0]] }],
    requirements: [{ name: 'Level', values: [['65', 0]] }],
    implicitMods: ['+20 to maximum [Mana|Mana]'],
    explicitMods: ['+35% to [Resistances|Lightning Resistance]'],
    runeMods: ['+12% to [Resistances|Fire Resistance]'],
  };

  it('normalizes a full rare item', () => {
    const detail = normalizeItemDetail(rawItem);
    expect(detail).toEqual({
      rarity: 'Rare',
      baseType: 'Vile Robe',
      itemLevel: 81,
      corrupted: true,
      properties: [{ label: 'Energy Shield', value: '412' }],
      requirements: [{ label: 'Level', value: '65' }],
      implicitMods: ['+20 to maximum Mana'],
      explicitMods: ['+35% to Lightning Resistance'],
      runeMods: ['+12% to Fire Resistance'],
      craftedMods: [],
    });
  });

  it('falls back to frameType when rarity is absent', () => {
    expect(normalizeItemDetail({ frameType: 3 })?.rarity).toBe('Unique');
    expect(normalizeItemDetail({ frameType: 9 })?.rarity).toBeNull();
  });

  it('returns null for non-object payloads', () => {
    expect(normalizeItemDetail(undefined)).toBeNull();
    expect(normalizeItemDetail('garbage')).toBeNull();
  });
});

describe('normalizeListing', () => {
  const detectedAt = '2026-06-12T10:00:00.000Z';

  it('normalizes a securable listing', () => {
    const listing = normalizeListing(
      {
        id: 'abc123',
        item: { name: 'Storm Veil', typeLine: 'Vile Robe' },
        listing: {
          price: { amount: 5, currency: 'divine' },
          account: { name: 'seller#1234' },
          hideout_token: 'jwt-token-here',
        },
      },
      'searchX',
      detectedAt,
    );
    expect(listing.listingId).toBe('abc123');
    expect(listing.searchId).toBe('searchX');
    expect(listing.itemName).toBe('Storm Veil Vile Robe');
    expect(listing.price).toEqual({ amount: 5, currency: 'divine' });
    expect(listing.seller).toBe('seller#1234');
    expect(listing.hideoutToken).toBe('jwt-token-here');
    expect(listing.detectedAt).toBe(detectedAt);
  });

  it('handles a price-less, non-securable listing', () => {
    const listing = normalizeListing(
      { id: 'x', item: { typeLine: 'Chaos Orb' }, listing: { account: { name: 's' } } },
      'searchX',
      detectedAt,
    );
    expect(listing.price).toBeNull();
    expect(listing.hideoutToken).toBeNull();
    expect(listing.itemName).toBe('Chaos Orb');
  });

  it('survives a degenerate payload', () => {
    const listing = normalizeListing({}, 'searchX', detectedAt);
    expect(listing.listingId).toBe('(unknown)');
    expect(listing.itemName).toBe('(unnamed item)');
    expect(listing.item).toBeNull();
  });
});
