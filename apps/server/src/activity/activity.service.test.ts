import { describe, expect, it } from 'vitest';
import type { BuyAutomationEvent, TravelEvent } from '@poe-sniper/shared';
import { openDatabase } from '../db/migrate.js';
import { hits, searches } from '../db/schema.js';
import { RealtimeBus } from '../events/realtime-bus.js';
import { ActivityService } from './activity.service.js';

function setup() {
  const database = openDatabase(':memory:');
  const bus = new RealtimeBus();
  const service = new ActivityService(database, bus);
  service.onApplicationBootstrap();
  return { database, bus, service };
}

const ALL = { search: null, outcome: null, from: null, to: null, limit: 50, offset: 0 } as const;

function travel(phase: TravelEvent['phase'], overrides: Partial<TravelEvent> = {}): TravelEvent {
  return {
    type: 'travel',
    phase,
    source: 'auto',
    searchId: 's1',
    listingId: 'l1',
    itemName: 'Astramentis',
    detail: null,
    reason: null,
    at: new Date().toISOString(),
    ...overrides,
  };
}
function buy(
  phase: BuyAutomationEvent['phase'],
  overrides: Partial<BuyAutomationEvent> = {},
): BuyAutomationEvent {
  return {
    type: 'buy',
    phase,
    searchId: 's1',
    listingId: 'l1',
    itemName: 'Astramentis',
    detail: null,
    at: new Date().toISOString(),
    ...overrides,
  };
}

describe('ActivityService', () => {
  it('assembles a full travel→buy→return record with the item snapshot', () => {
    const { database, bus, service } = setup();
    database
      .insert(searches)
      .values({
        id: 's1',
        realm: 'poe2',
        league: 'Standard',
        label: 'Spears',
        autoTravel: true,
        autoBuy: true,
        enabled: true,
        purchaseMode: null,
        filters: {},
        addedAt: new Date().toISOString(),
      })
      .run();
    database
      .insert(hits)
      .values({
        searchId: 's1',
        listingId: 'l1',
        itemName: 'Astramentis',
        price: { amount: 12, currency: 'divine' },
        seller: 'Xyz#1',
        item: {
          rarity: 'unique',
          baseType: 'Amulet',
          itemLevel: 80,
          corrupted: false,
          properties: [],
          requirements: [],
          implicitMods: [],
          explicitMods: [],
          runeMods: [],
          craftedMods: [],
        },
        detectedAt: new Date().toISOString(),
      })
      .run();

    for (const event of [
      travel('started'),
      travel('success'),
      buy('window-found'),
      buy('item-located'),
      buy('moved'),
      buy('returning'),
      buy('returned'),
    ]) {
      bus.publish(event);
    }

    const records = service.listActivity({ ...ALL });
    expect(records).toHaveLength(1);
    const record = records[0]!;
    expect(record.outcome).toBe('placed');
    expect(record.returnedHome).toBe(true);
    expect(record.finishedAt).not.toBeNull();
    expect(record.seller).toBe('Xyz#1');
    expect(record.price).toEqual({ amount: 12, currency: 'divine' });
    expect(record.item?.baseType).toBe('Amulet');
    expect(record.steps.map((step) => step.phase)).toEqual([
      'started',
      'success',
      'window-found',
      'item-located',
      'moved',
      'returning',
      'returned',
    ]);
  });

  it('records item-sold (with a return) and travel-failed outcomes', () => {
    const { bus, service } = setup();
    for (const event of [
      travel('started', { listingId: 'sold1' }),
      buy('failed', { listingId: 'sold1', detail: 'item-sold' }),
      buy('returning', { listingId: 'sold1' }),
      buy('returned', { listingId: 'sold1' }),
      travel('started', { listingId: 'tf1' }),
      travel('failed', { listingId: 'tf1', detail: 'HTTP 403' }),
    ]) {
      bus.publish(event);
    }

    const records = service.listActivity({ ...ALL });
    const sold = records.find((record) => record.listingId === 'sold1');
    const failed = records.find((record) => record.listingId === 'tf1');
    expect(sold?.outcome).toBe('item-sold');
    expect(sold?.returnedHome).toBe(true);
    expect(failed?.outcome).toBe('travel-failed');
    expect(failed?.finishedAt).not.toBeNull();
  });
});
