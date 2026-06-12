import { describe, expect, it, vi } from 'vitest';
import type { Listing } from '@poe-sniper/shared';
import { loadConfig } from '../config/env.js';
import { openDatabase } from '../db/migrate.js';
import { PollEngine } from '../engines/poll-engine.js';
import { RealtimeBus } from '../events/realtime-bus.js';
import type { OutboundGuard } from '../guard/outbound-guard.js';
import type { TradeApiClient } from '../trade-api/trade-api.client.js';
import type { EngineFactory } from './engine-registry.js';
import { SearchManager } from './search-manager.js';

const ARMED_GUARD = { tripped: false } as OutboundGuard;

const SECURABLE_QUERY = { status: { option: 'securable' }, stats: [] };
const ANY_QUERY = { status: { option: 'any' }, stats: [] };

function createManager(resolvedQuery: unknown = SECURABLE_QUERY) {
  const database = openDatabase(':memory:');
  const config = loadConfig({});
  const realtimeBus = new RealtimeBus();
  const events: string[] = [];
  realtimeBus.subscribe((event) => events.push(event.type));

  const executeSearch = vi.fn(() =>
    Promise.resolve({ ids: [] as string[], total: 0, rateLimited: false }),
  );
  const tradeApi = {
    resolveQuery: vi.fn(() => Promise.resolve(resolvedQuery)),
    executeSearch,
    fetchListings: vi.fn(() => Promise.resolve([] as Listing[])),
  } as unknown as TradeApiClient;

  // Registry stub mirrors production order: ws (probe fails — GGG live down),
  // poll as the always-on fallback.
  const registry: EngineFactory[] = [
    {
      kind: 'ws',
      probe: () => Promise.resolve(false),
      create: () => new PollEngine(config, tradeApi),
    },
    {
      kind: 'poll',
      probe: () => Promise.resolve(true),
      create: () => new PollEngine(config, tradeApi),
    },
  ];

  const manager = new SearchManager(config, database, registry, tradeApi, realtimeBus, ARMED_GUARD);
  return { manager, database, tradeApi, events, executeSearch };
}

describe('SearchManager', () => {
  it('adds a search: resolves the query, persists, starts the poll engine', async () => {
    const { manager, database, tradeApi } = createManager();
    try {
      const info = await manager.add('AbCdEf123', { label: 'My search' });
      expect(tradeApi.resolveQuery).toHaveBeenCalledOnce();
      expect(info.engine).toBe('poll');
      expect(info.status).toBe('active');
      expect(manager.list()).toHaveLength(1);

      const persisted = database.$client.prepare('SELECT id, label FROM searches').all() as Array<{
        id: string;
        label: string;
      }>;
      expect(persisted).toEqual([{ id: 'AbCdEf123', label: 'My search' }]);
    } finally {
      manager.onApplicationShutdown();
      database.$client.close();
    }
  });

  it('rejects a duplicate watch', async () => {
    const { manager, database } = createManager();
    try {
      await manager.add('AbCdEf123', {});
      await expect(manager.add('AbCdEf123', {})).rejects.toThrowError(/already watched/);
    } finally {
      manager.onApplicationShutdown();
      database.$client.close();
    }
  });

  it('rejects auto-travel on a non-securable query without an instant override', async () => {
    const { manager, database } = createManager(ANY_QUERY);
    try {
      await expect(manager.add('AbCdEf123', { autoTravel: true })).rejects.toThrowError(
        /securable/,
      );
      await expect(
        manager.add('AbCdEf123', { autoTravel: true, purchaseMode: 'instant' }),
      ).resolves.toMatchObject({ autoTravel: true });
    } finally {
      manager.onApplicationShutdown();
      database.$client.close();
    }
  });

  it('round-robins exactly one poll tick per scheduler round', async () => {
    const { manager, database, executeSearch } = createManager();
    try {
      await manager.add('first11', {});
      await manager.add('second22', {});
      executeSearch.mockClear();

      await manager.runSchedulerTick();
      expect(executeSearch).toHaveBeenCalledTimes(1);
      await manager.runSchedulerTick();
      expect(executeSearch).toHaveBeenCalledTimes(2);
      const tickedSearches = executeSearch.mock.calls.map(
        (call) => (call as unknown as [{ searchId: string }])[0].searchId,
      );
      expect(new Set(tickedSearches).size).toBe(2);
    } finally {
      manager.onApplicationShutdown();
      database.$client.close();
    }
  });

  it('persists detected hits and publishes hit events', async () => {
    const { manager, database, tradeApi, events, executeSearch } = createManager();
    try {
      await manager.add('AbCdEf123', {});
      // Baseline round, then a round with one fresh id.
      await manager.runSchedulerTick();
      executeSearch.mockResolvedValueOnce({ ids: ['fresh1'], total: 1, rateLimited: false });
      (tradeApi.fetchListings as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        {
          listingId: 'fresh1',
          searchId: 'AbCdEf123',
          itemName: 'Storm Veil',
          price: { amount: 5, currency: 'divine' },
          seller: 'seller#1',
          hideoutToken: 'jwt',
          item: null,
          detectedAt: '2026-06-12T10:00:00.000Z',
        },
      ]);
      await manager.runSchedulerTick();

      const hitRows = database.$client
        .prepare('SELECT listing_id, item_name FROM hits')
        .all() as Array<{ listing_id: string; item_name: string }>;
      expect(hitRows).toEqual([{ listing_id: 'fresh1', item_name: 'Storm Veil' }]);
      expect(events).toContain('hit');

      const hitsViaApi = manager.listHits(null, 50);
      expect(hitsViaApi[0]?.listingId).toBe('fresh1');
      expect(hitsViaApi[0]?.hideoutToken).toBeNull();
    } finally {
      manager.onApplicationShutdown();
      database.$client.close();
    }
  });

  it('remove stops the engine and deletes rows', async () => {
    const { manager, database, executeSearch } = createManager();
    try {
      await manager.add('AbCdEf123', {});
      manager.remove('AbCdEf123');
      expect(manager.list()).toHaveLength(0);
      executeSearch.mockClear();
      await manager.runSchedulerTick();
      expect(executeSearch).not.toHaveBeenCalled();
      expect(() => manager.remove('AbCdEf123')).toThrowError(/not watched/);
    } finally {
      manager.onApplicationShutdown();
      database.$client.close();
    }
  });

  it('prunes hit history beyond HITS_MAX_ROWS', async () => {
    const { manager, database } = createManager();
    try {
      await manager.add('AbCdEf123', {});
      const insert = database.$client.prepare(
        `INSERT INTO hits (search_id, listing_id, item_name, price, seller, item, detected_at)
         VALUES ('AbCdEf123', ?, 'Item', NULL, 's', NULL, '2026-06-12T10:00:00.000Z')`,
      );
      for (let index = 0; index < 150; index += 1) insert.run(`listing-${index}`);

      manager.onApplicationShutdown();
      const reloaded = new SearchManager(
        loadConfig({ HITS_MAX_ROWS: '100' }),
        database,
        [],
        { resolveQuery: vi.fn() } as unknown as TradeApiClient,
        new RealtimeBus(),
        ARMED_GUARD,
      );
      reloaded.onApplicationBootstrap(); // bootstrap prunes
      try {
        const count = database.$client.prepare('SELECT COUNT(*) AS c FROM hits').get() as {
          c: number;
        };
        expect(count.c).toBe(100);
        const newest = database.$client
          .prepare('SELECT listing_id FROM hits ORDER BY id DESC LIMIT 1')
          .get() as { listing_id: string };
        expect(newest.listing_id).toBe('listing-149'); // newest survive
      } finally {
        reloaded.onApplicationShutdown();
      }
    } finally {
      database.$client.close();
    }
  });

  it('reloads persisted searches on bootstrap', async () => {
    const { manager, database } = createManager();
    try {
      await manager.add('AbCdEf123', { label: 'persisted' });
      manager.onApplicationShutdown();

      const reborn = new SearchManager(
        loadConfig({}),
        database,
        [
          {
            kind: 'poll',
            probe: () => Promise.resolve(true),
            create: () =>
              new PollEngine(loadConfig({}), {
                executeSearch: () => Promise.resolve({ ids: [], total: 0, rateLimited: false }),
                fetchListings: () => Promise.resolve([]),
              }),
          },
        ],
        { resolveQuery: vi.fn() } as unknown as TradeApiClient,
        new RealtimeBus(),
        ARMED_GUARD,
      );
      reborn.onApplicationBootstrap();
      try {
        expect(reborn.list()).toHaveLength(1);
        expect(reborn.list()[0]?.label).toBe('persisted');
      } finally {
        reborn.onApplicationShutdown();
      }
    } finally {
      database.$client.close();
    }
  });
});
