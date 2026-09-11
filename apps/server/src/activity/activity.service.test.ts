import { describe, expect, it } from 'vitest';
import type { BuyAutomationEvent, TravelEvent } from '@poe-sniper/shared';
import { loadConfig } from '../config/env.js';
import { openDatabase } from '../db/migrate.js';
import { activity, hits, searches } from '../db/schema.js';
import { RealtimeBus } from '../events/realtime-bus.js';
import { ActivityService } from './activity.service.js';

function setup(overrides: Record<string, string> = {}) {
  const database = openDatabase(':memory:');
  const bus = new RealtimeBus();
  const service = new ActivityService(database, bus, loadConfig({ ...overrides }));
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

describe('ActivityService pruning (bounded growth)', () => {
  /** Seeds `count` finished sequences, oldest first (`started_at` ascending). */
  function seed(database: ReturnType<typeof openDatabase>, count: number): void {
    for (let index = 0; index < count; index += 1) {
      database
        .insert(activity)
        .values({
          id: `a${index}`,
          searchId: 's1',
          listingId: `l${index}`,
          source: 'auto',
          itemName: `item-${index}`,
          price: null,
          seller: null,
          item: null,
          // Zero-padded so the ISO string sorts the same way the number does.
          startedAt: `2026-01-01T00:${String(index).padStart(2, '0')}:00.000Z`,
          finishedAt: `2026-01-01T00:${String(index).padStart(2, '0')}:30.000Z`,
          outcome: 'placed',
          returnedHome: true,
          steps: [],
        })
        .run();
    }
  }

  it('prunes to the newest ACTIVITY_MAX_ROWS on boot, dropping the OLDEST rows', () => {
    const database = openDatabase(':memory:');
    seed(database, 55);

    const service = new ActivityService(
      database,
      new RealtimeBus(),
      loadConfig({ ACTIVITY_MAX_ROWS: '50' }),
    );
    service.onApplicationBootstrap();

    const records = service.listActivity({ ...ALL, limit: 100 });
    expect(records).toHaveLength(50);
    // The 5 oldest (item-0..item-4) are gone; the newest survives.
    const names = records.map((record) => record.itemName);
    expect(names).toContain('item-54');
    expect(names).not.toContain('item-0');
    expect(names).not.toContain('item-4');
    expect(names).toContain('item-5');
  });

  it('leaves the table alone while it is under the cap', () => {
    const database = openDatabase(':memory:');
    seed(database, 10);

    const service = new ActivityService(
      database,
      new RealtimeBus(),
      loadConfig({ ACTIVITY_MAX_ROWS: '50' }),
    );
    service.onApplicationBootstrap();

    expect(service.listActivity({ ...ALL, limit: 100 })).toHaveLength(10);
  });
});
