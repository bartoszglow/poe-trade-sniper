import { describe, expect, it, vi } from 'vitest';
import type { Listing } from '@poe-sniper/shared';
import { loadConfig } from '../config/env.js';
import { openDatabase } from '../db/migrate.js';
import { hits } from '../db/schema.js';
import type {
  DetectionEngine,
  EngineCallbacks,
  EngineContext,
} from '../engines/detection-engine.js';
import { PollEngine } from '../engines/poll-engine.js';
import { RealtimeBus } from '../events/realtime-bus.js';
import type { OutboundGuard } from '../guard/outbound-guard.js';
import type { TradeApiClient } from '../trade-api/trade-api.client.js';
import type { EngineFactory } from './engine-registry.js';
import { SearchManager } from './search-manager.js';

const ARMED_GUARD = {
  tripped: false,
  wsConnectBudgetRemaining: () => 100,
} as unknown as OutboundGuard;

const SECURABLE_QUERY = { status: { option: 'securable' }, stats: [] };
const ANY_QUERY = { status: { option: 'any' }, stats: [] };

/** No-op ws engine that captures its callbacks so tests can trigger onDemote. */
class FakeWsEngine implements DetectionEngine {
  readonly kind = 'ws';
  callbacks: EngineCallbacks | null = null;
  start(_context: EngineContext, callbacks: EngineCallbacks): void {
    this.callbacks = callbacks;
  }
  stop(): void {}
}

function createManager(options: { resolvedQuery?: unknown; guard?: OutboundGuard } = {}) {
  const resolvedQuery = options.resolvedQuery ?? SECURABLE_QUERY;
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

  // Controllable ws probe (GGG live backend up/down) + observable ws engines.
  const wsProbe = vi.fn(() => Promise.resolve(false));
  const wsEngines: FakeWsEngine[] = [];
  const registry: EngineFactory[] = [
    {
      kind: 'ws',
      probe: wsProbe,
      create: () => {
        const engine = new FakeWsEngine();
        wsEngines.push(engine);
        return engine;
      },
    },
    {
      kind: 'poll',
      probe: () => Promise.resolve(true),
      create: () => new PollEngine(config, tradeApi),
    },
  ];

  const manager = new SearchManager(
    config,
    database,
    registry,
    tradeApi,
    realtimeBus,
    options.guard ?? ARMED_GUARD,
  );
  return { manager, database, tradeApi, events, executeSearch, wsProbe, wsEngines };
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
    const { manager, database } = createManager({ resolvedQuery: ANY_QUERY });
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

  it('pause stops detection, resume restarts it, both survive scheduler ticks', async () => {
    const { manager, database, executeSearch } = createManager();
    try {
      await manager.add('AbCdEf123', {});

      let info = manager.update('AbCdEf123', { enabled: false });
      expect(info.enabled).toBe(false);
      expect(info.status).toBe('stopped');
      expect(info.engine).toBeNull();

      // Paused searches must produce zero outbound traffic.
      executeSearch.mockClear();
      await manager.runSchedulerTick();
      await manager.runSchedulerTick();
      expect(executeSearch).not.toHaveBeenCalled();

      // Pause is persisted — survives a restart.
      const persisted = database.$client
        .prepare('SELECT enabled FROM searches WHERE id = ?')
        .get('AbCdEf123') as { enabled: number };
      expect(persisted.enabled).toBe(0);

      info = manager.update('AbCdEf123', { enabled: true });
      expect(info.enabled).toBe(true);
      await manager.runSchedulerTick();
      expect(executeSearch).toHaveBeenCalled();
    } finally {
      manager.onApplicationShutdown();
      database.$client.close();
    }
  });

  it('restores hit count and last-hit from persisted hits on bootstrap', async () => {
    const { manager, database } = createManager();
    try {
      await manager.add('AbCdEf123', {});
      // Two hits as if detected in a previous run (UI must not reset to 0).
      database
        .insert(hits)
        .values([
          {
            searchId: 'AbCdEf123',
            listingId: 'l1',
            itemName: 'Item A',
            price: null,
            seller: '',
            item: null,
            detectedAt: '2026-06-12T10:00:00.000Z',
          },
          {
            searchId: 'AbCdEf123',
            listingId: 'l2',
            itemName: 'Item B',
            price: null,
            seller: '',
            item: null,
            detectedAt: '2026-06-12T11:00:00.000Z',
          },
        ])
        .run();
      manager.onApplicationShutdown();

      const reloaded = new SearchManager(
        loadConfig({}),
        database,
        [],
        {} as TradeApiClient,
        new RealtimeBus(),
        ARMED_GUARD,
      );
      reloaded.onApplicationBootstrap();
      try {
        const info = reloaded.list().find((entry) => entry.id === 'AbCdEf123');
        expect(info?.hitCount).toBe(2);
        expect(info?.lastHitAt).toBe('2026-06-12T11:00:00.000Z');
      } finally {
        reloaded.onApplicationShutdown();
      }
    } finally {
      manager.onApplicationShutdown();
      database.$client.close();
    }
  });

  it('a paused search stays stopped after bootstrap reload', async () => {
    const { manager, database } = createManager();
    try {
      await manager.add('AbCdEf123', {});
      manager.update('AbCdEf123', { enabled: false });
      manager.onApplicationShutdown();

      const reloaded = new SearchManager(
        loadConfig({}),
        database,
        [],
        {} as TradeApiClient,
        new RealtimeBus(),
        ARMED_GUARD,
      );
      reloaded.onApplicationBootstrap();
      try {
        const info = reloaded.list().find((entry) => entry.id === 'AbCdEf123');
        expect(info?.enabled).toBe(false);
        expect(info?.status).toBe('stopped');
      } finally {
        reloaded.onApplicationShutdown();
      }
    } finally {
      manager.onApplicationShutdown();
      database.$client.close();
    }
  });

  it('ws-availability probe is decoupled from the poll tick (one shared probe)', async () => {
    const { manager, database, wsProbe } = createManager();
    try {
      await manager.add('first11', {});
      await manager.add('second22', {});
      wsProbe.mockClear();

      // Poll ticks must NOT probe ws — that is the whole decoupling.
      await manager.runSchedulerTick();
      await manager.runSchedulerTick();
      expect(wsProbe).not.toHaveBeenCalled();

      // One shared probe answers for BOTH searches — not one probe per search.
      await manager.probeLiveBackend();
      expect(wsProbe).toHaveBeenCalledTimes(1);
    } finally {
      manager.onApplicationShutdown();
      database.$client.close();
    }
  });

  it('promotes every poll search to ws at once when the shared probe succeeds', async () => {
    const { manager, database, wsProbe, executeSearch } = createManager();
    try {
      await manager.add('first11', {});
      await manager.add('second22', {});
      expect(manager.list().every((info) => info.engine === 'poll')).toBe(true);

      wsProbe.mockResolvedValue(true);
      await manager.probeLiveBackend();
      await manager.runSchedulerTick(); // promotion happens inside the tick

      expect(manager.list().every((info) => info.engine === 'ws')).toBe(true);
      // No poll watchers remain → no more search POSTs.
      executeSearch.mockClear();
      await manager.runSchedulerTick();
      expect(executeSearch).not.toHaveBeenCalled();
    } finally {
      manager.onApplicationShutdown();
      database.$client.close();
    }
  });

  it('promotion respects the guard ws-connect ceiling, deferring the rest', async () => {
    const guard = {
      tripped: false,
      wsConnectBudgetRemaining: () => 1,
    } as unknown as OutboundGuard;
    const { manager, database, wsProbe } = createManager({ guard });
    try {
      await manager.add('first11', {});
      await manager.add('second22', {});

      wsProbe.mockResolvedValue(true);
      await manager.probeLiveBackend();
      await manager.runSchedulerTick();

      const engines = manager.list().map((info) => info.engine);
      expect(engines.filter((engine) => engine === 'ws')).toHaveLength(1);
      expect(engines.filter((engine) => engine === 'poll')).toHaveLength(1);
    } finally {
      manager.onApplicationShutdown();
      database.$client.close();
    }
  });

  it('a demoted ws search falls back to poll and is re-promoted by the shared probe', async () => {
    const { manager, database, wsProbe, wsEngines, executeSearch } = createManager();
    try {
      wsProbe.mockResolvedValue(true);
      await manager.add('AbCdEf123', {}); // starts on ws (probe passes at add)
      expect(manager.list()[0]?.engine).toBe('ws');

      // Engine hands the search back (unstable ws / 1013).
      wsEngines[0]?.callbacks?.onDemote('unstable ws (close code 1013)');
      expect(manager.list()[0]?.engine).toBe('poll');
      executeSearch.mockClear();
      await manager.runSchedulerTick();
      expect(executeSearch).toHaveBeenCalled(); // poll keeps detection alive

      // Backend recovers → shared probe re-promotes it.
      await manager.probeLiveBackend();
      await manager.runSchedulerTick();
      expect(manager.list()[0]?.engine).toBe('ws');
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
