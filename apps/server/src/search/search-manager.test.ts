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
import { PermissionDeniedError } from '../permissions/permission-denied.error.js';
import type { PermissionGateService } from '../permissions/permission-gate.service.js';
import type { TradeApiClient } from '../trade-api/trade-api.client.js';
import type { EngineFactory } from './engine-registry.js';
import { LiveOfferRegistry } from './live-offer-registry.js';
import { SearchManager } from './search-manager.js';

const ARMED_GUARD = { tripped: false } as unknown as OutboundGuard;
/** Gate that grants control (auto-buy allowed); the inverse refuses it. */
const ALLOW_GATE = { canControl: () => true } as unknown as PermissionGateService;
const DENY_GATE = { canControl: () => false } as unknown as PermissionGateService;

const SECURABLE_QUERY = { status: { option: 'securable' }, stats: [] };
const ANY_QUERY = { status: { option: 'any' }, stats: [] };

/** No-op ws engine that captures its callbacks so tests can drive ws status. */
class FakeWsEngine implements DetectionEngine {
  readonly kind = 'ws';
  callbacks: EngineCallbacks | null = null;
  start(_context: EngineContext, callbacks: EngineCallbacks): void {
    this.callbacks = callbacks;
  }
  stop(): void {}
}

function createManager(
  options: { resolvedQuery?: unknown; guard?: OutboundGuard; gate?: PermissionGateService } = {},
) {
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

  // Observable persistent ws engines (one per search); poll covers the gaps.
  const wsEngines: FakeWsEngine[] = [];
  const registry: EngineFactory[] = [
    {
      kind: 'ws',
      create: () => {
        const engine = new FakeWsEngine();
        wsEngines.push(engine);
        return engine;
      },
    },
    {
      kind: 'poll',
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
    options.gate ?? ALLOW_GATE,
    new LiveOfferRegistry(config),
  );
  return { manager, database, tradeApi, events, executeSearch, wsEngines };
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

  it('allows auto-buy without auto-travel (D-19) but refuses it without control permission (#2=B)', async () => {
    // Buy is independent of auto-travel — only the macOS control permission gates it.
    const independent = createManager();
    try {
      const info = await independent.manager.add('AbCdEf123', { autoBuy: true });
      expect(info.autoBuy).toBe(true);
      expect(info.autoTravel).toBe(false);
    } finally {
      independent.manager.onApplicationShutdown();
      independent.database.$client.close();
    }

    const noControl = createManager({ gate: DENY_GATE });
    try {
      await expect(noControl.manager.add('AbCdEf123', { autoBuy: true })).rejects.toThrowError(
        /Screen Recording/,
      );
    } finally {
      noControl.manager.onApplicationShutdown();
      noControl.database.$client.close();
    }
  });

  it('does not block an unrelated update after control is revoked (CORR-1, #2=B)', async () => {
    let control = true;
    const gate = {
      canControl: () => control,
      assert: () => {
        if (!control) throw new PermissionDeniedError('control', ['accessibility']);
      },
    } as unknown as PermissionGateService;
    const { manager, database } = createManager({ gate });
    try {
      await manager.add('AbCdEf123', { autoBuy: true });
      control = false; // operator revokes Screen Recording / Accessibility
      // An unrelated patch (rename) must still succeed — persisted autoBuy preserved.
      const renamed = manager.update('AbCdEf123', { label: 'renamed' });
      expect(renamed.label).toBe('renamed');
      expect(renamed.autoBuy).toBe(true);
      // But turning Buy ON again while revoked is still refused.
      expect(() => manager.update('AbCdEf123', { autoBuy: true })).toThrowError(/Screen Recording/);
    } finally {
      manager.onApplicationShutdown();
      database.$client.close();
    }
  });

  it('persists auto-buy with travel + control permission, round-trips, and toggles off', async () => {
    const { manager, database } = createManager();
    try {
      const info = await manager.add('AbCdEf123', { autoTravel: true, autoBuy: true });
      expect(info.autoBuy).toBe(true);
      expect(manager.isAutoBuyEnabled('AbCdEf123')).toBe(true);
      const persisted = database.$client
        .prepare('SELECT auto_buy FROM searches WHERE id = ?')
        .get('AbCdEf123') as { auto_buy: number };
      expect(persisted.auto_buy).toBe(1);

      const off = manager.update('AbCdEf123', { autoBuy: false });
      expect(off.autoBuy).toBe(false);
      expect(manager.isAutoBuyEnabled('AbCdEf123')).toBe(false);
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

  it('global pause halts enabled searches as PAUSED, resume brings them back', async () => {
    const { manager, database, executeSearch } = createManager();
    try {
      await manager.add('AbCdEf123', {});
      expect(manager.isDetectionPaused()).toBe(false);

      expect(manager.setDetectionPaused(true)).toBe(true);
      expect(manager.isDetectionPaused()).toBe(true);
      const paused = manager.list()[0]!;
      expect(paused.status).toBe('paused');
      expect(paused.engine).toBeNull();
      expect(paused.enabled).toBe(true); // enabled flag preserved, just halted

      // Globally paused → zero outbound on scheduler ticks.
      executeSearch.mockClear();
      await manager.runSchedulerTick();
      await manager.runSchedulerTick();
      expect(executeSearch).not.toHaveBeenCalled();

      manager.setDetectionPaused(false);
      const resumed = manager.list()[0]!;
      expect(resumed.status).toBe('active');
      expect(resumed.engine).toBe('poll');
    } finally {
      manager.onApplicationShutdown();
      database.$client.close();
    }
  });

  it('global pause leaves an already-disabled search STOPPED, and resume keeps it so', async () => {
    const { manager, database } = createManager();
    try {
      await manager.add('AbCdEf123', {});
      manager.update('AbCdEf123', { enabled: false });

      manager.setDetectionPaused(true);
      expect(manager.list()[0]!.status).toBe('stopped'); // not PAUSED — it was disabled

      manager.setDetectionPaused(false);
      const info = manager.list()[0]!;
      expect(info.status).toBe('stopped'); // resume must not re-activate a disabled search
      expect(info.enabled).toBe(false);
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
        ALLOW_GATE,
        new LiveOfferRegistry(loadConfig({})),
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

  it('listHits filters by text + date range, sorts, and paginates', async () => {
    const { manager, database } = createManager();
    try {
      await manager.add('AbCdEf123', {});
      const rows: Array<[string, string, string, string]> = [
        ['l1', 'Storm Veil', 'alice', '2026-06-10T10:00:00.000Z'],
        ['l2', 'Storm Cloud', 'bob', '2026-06-11T10:00:00.000Z'],
        ['l3', 'Sunder Axe', 'alice', '2026-06-12T10:00:00.000Z'],
        ['l4', 'Storm Relic', 'carol', '2026-06-13T10:00:00.000Z'],
      ];
      database
        .insert(hits)
        .values(
          rows.map(([listingId, itemName, seller, detectedAt]) => ({
            searchId: 'AbCdEf123',
            listingId,
            itemName,
            price: null,
            seller,
            item: null,
            detectedAt,
          })),
        )
        .run();
      const baseQuery = {
        searchId: null,
        search: null,
        from: null,
        to: null,
        sort: 'newest' as const,
        limit: 50,
        offset: 0,
      };

      // Text search matches item name OR seller.
      expect(
        manager.listHits({ ...baseQuery, search: 'Storm' }).map((hit) => hit.listingId),
      ).toEqual(['l4', 'l2', 'l1']);
      expect(
        manager.listHits({ ...baseQuery, search: 'carol' }).map((hit) => hit.listingId),
      ).toEqual(['l4']);

      // Date range is inclusive.
      expect(
        manager
          .listHits({
            ...baseQuery,
            from: '2026-06-11T00:00:00.000Z',
            to: '2026-06-12T23:59:59.000Z',
          })
          .map((hit) => hit.listingId),
      ).toEqual(['l3', 'l2']);

      // Sort + pagination.
      expect(manager.listHits({ ...baseQuery, sort: 'oldest' })[0]?.listingId).toBe('l1');
      expect(manager.listHits({ ...baseQuery, sort: 'name' })[0]?.itemName).toBe('Storm Cloud');
      expect(
        manager.listHits({ ...baseQuery, limit: 2, offset: 2 }).map((hit) => hit.listingId),
      ).toEqual(['l2', 'l1']);
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
        ALLOW_GATE,
        new LiveOfferRegistry(loadConfig({})),
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

  it('poll covers the gap until ws connects, then poll stops (no double traffic)', async () => {
    const { manager, database, wsEngines, executeSearch } = createManager();
    try {
      await manager.add('AbCdEf123', {});
      // ws not connected yet → poll covers; display kind is poll.
      expect(manager.list()[0]?.engine).toBe('poll');
      await manager.runSchedulerTick();
      expect(executeSearch).toHaveBeenCalled();

      // ws connects → poll coverage drops, push takes over.
      wsEngines[0]?.callbacks?.onStatus('active', 'live websocket connected');
      expect(manager.list()[0]?.engine).toBe('ws');
      executeSearch.mockClear();
      await manager.runSchedulerTick();
      expect(executeSearch).not.toHaveBeenCalled();
    } finally {
      manager.onApplicationShutdown();
      database.$client.close();
    }
  });

  it('ws drop brings poll coverage back, ws reconnect drops it again', async () => {
    const { manager, database, wsEngines, executeSearch } = createManager();
    try {
      await manager.add('AbCdEf123', {});
      wsEngines[0]?.callbacks?.onStatus('active', 'connected');
      expect(manager.list()[0]?.engine).toBe('ws');

      // ws drops (engine keeps reconnecting on its own) → poll covers the gap.
      wsEngines[0]?.callbacks?.onStatus('degraded', 'live connection lost (code 1013)');
      expect(manager.list()[0]?.engine).toBe('poll');
      executeSearch.mockClear();
      await manager.runSchedulerTick();
      expect(executeSearch).toHaveBeenCalled();

      // ws comes back → poll stops again.
      wsEngines[0]?.callbacks?.onStatus('active', 'reconnected');
      expect(manager.list()[0]?.engine).toBe('ws');
    } finally {
      manager.onApplicationShutdown();
      database.$client.close();
    }
  });

  it('runs one persistent ws engine per search (a socket per browser-tab)', async () => {
    const { manager, database, wsEngines } = createManager();
    try {
      await manager.add('first11', {});
      await manager.add('second22', {});
      expect(wsEngines).toHaveLength(2);
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

      const hitsViaApi = manager.listHits({
        searchId: null,
        search: null,
        from: null,
        to: null,
        sort: 'newest',
        limit: 50,
        offset: 0,
      });
      expect(hitsViaApi[0]?.listingId).toBe('fresh1');
      expect(hitsViaApi[0]?.hideoutToken).toBeNull();
    } finally {
      manager.onApplicationShutdown();
      database.$client.close();
    }
  });

  it('dedups a re-served listing — same id shows once across emits (#3)', async () => {
    const { manager, database, events, wsEngines } = createManager();
    try {
      await manager.add('AbCdEf123', {});
      wsEngines[0]?.callbacks?.onStatus('active', 'connected');
      const listing = {
        listingId: 'dup1',
        searchId: 'AbCdEf123',
        itemName: 'Storm Veil',
        price: { amount: 5, currency: 'divine' },
        seller: 'seller#1',
        hideoutToken: 'jwt',
        item: null,
        detectedAt: '2026-06-12T10:00:00.000Z',
      };
      // GGG re-serves the same listing (ws has no engine-level dedup; this also
      // models the ws↔poll re-emit after a travel). It must count as ONE hit.
      wsEngines[0]?.callbacks?.onListings([listing]);
      wsEngines[0]?.callbacks?.onListings([listing]);
      wsEngines[0]?.callbacks?.onListings([listing]);

      const hitRows = database.$client.prepare('SELECT listing_id FROM hits').all() as Array<{
        listing_id: string;
      }>;
      expect(hitRows).toEqual([{ listing_id: 'dup1' }]);
      expect(events.filter((type) => type === 'hit')).toHaveLength(1);
    } finally {
      manager.onApplicationShutdown();
      database.$client.close();
    }
  });

  it('a re-served offer under a NEW id is hit-updated, not a second hit (#3)', async () => {
    const { manager, database, events, wsEngines } = createManager();
    try {
      await manager.add('AbCdEf123', {});
      wsEngines[0]?.callbacks?.onStatus('active', 'connected');
      const offer = {
        searchId: 'AbCdEf123',
        itemName: 'Storm Veil',
        price: { amount: 5, currency: 'divine' },
        seller: 'seller#1',
        hideoutToken: 'jwt',
        item: null,
        detectedAt: '2026-06-12T10:00:00.000Z',
      };
      // Same offer, fresh GGG result-hash id (models the ws/poll re-serve after a travel
      // re-query). The feed updates, but it must NOT count as a new hit — so auto-travel/buy
      // (which only act on `hit`) never re-fire, and only the first offer is stored.
      wsEngines[0]?.callbacks?.onListings([{ ...offer, listingId: 'id-1' }]);
      wsEngines[0]?.callbacks?.onListings([{ ...offer, listingId: 'id-2' }]);

      expect(events.filter((type) => type === 'hit')).toHaveLength(1);
      expect(events.filter((type) => type === 'hit-updated')).toHaveLength(1);
      const hitRows = database.$client.prepare('SELECT listing_id FROM hits').all() as Array<{
        listing_id: string;
      }>;
      expect(hitRows).toEqual([{ listing_id: 'id-1' }]);
    } finally {
      manager.onApplicationShutdown();
      database.$client.close();
    }
  });

  it('exports searches and re-imports them (round-trip, skip-existing) (#27)', async () => {
    const { manager, database } = createManager();
    try {
      await manager.add('AbCdEf123', { label: 'My search' });
      const exported = manager.exportSearches();
      const [first] = exported;
      if (!first) throw new Error('expected one exported search');
      expect(first.id).toBe('AbCdEf123');

      // Re-importing the same export skips the already-present search.
      expect(manager.importSearches(exported, 'skip')).toEqual({
        imported: 0,
        skipped: 1,
        errors: [],
      });

      // A different id is restored straight from the export shape (no resolveQuery).
      const result = manager.importSearches(
        [{ ...first, id: 'NewSearch1', label: 'Restored' }],
        'skip',
      );
      expect(result.imported).toBe(1);
      expect(manager.list().find((entry) => entry.id === 'NewSearch1')?.label).toBe('Restored');
    } finally {
      manager.onApplicationShutdown();
      database.$client.close();
    }
  });

  it('reorders searches and persists the order across a reload (#29)', async () => {
    const { manager, database } = createManager();
    try {
      await manager.add('AbCdEf001', { label: 'A' });
      await manager.add('AbCdEf002', { label: 'B' });
      await manager.add('AbCdEf003', { label: 'C' });
      expect(manager.list().map((entry) => entry.id)).toEqual([
        'AbCdEf001',
        'AbCdEf002',
        'AbCdEf003',
      ]);

      manager.reorder(['AbCdEf003', 'AbCdEf001', 'AbCdEf002']);
      expect(manager.list().map((entry) => entry.id)).toEqual([
        'AbCdEf003',
        'AbCdEf001',
        'AbCdEf002',
      ]);
      manager.onApplicationShutdown();

      // Persisted: a fresh manager on the same DB rehydrates in the saved order.
      const reloaded = new SearchManager(
        loadConfig({}),
        database,
        [],
        { resolveQuery: vi.fn() } as unknown as TradeApiClient,
        new RealtimeBus(),
        ARMED_GUARD,
        ALLOW_GATE,
        new LiveOfferRegistry(loadConfig({})),
      );
      reloaded.onApplicationBootstrap();
      try {
        expect(reloaded.list().map((entry) => entry.id)).toEqual([
          'AbCdEf003',
          'AbCdEf001',
          'AbCdEf002',
        ]);
      } finally {
        reloaded.onApplicationShutdown();
      }
    } finally {
      database.$client.close();
    }
  });

  it('reorder is race-tolerant — unknown ids skipped, unmentioned appended (#29)', async () => {
    const { manager, database } = createManager();
    try {
      await manager.add('AbCdEf001', {});
      await manager.add('AbCdEf002', {});
      await manager.add('AbCdEf003', {});
      // Mentions a ghost id (skipped) and omits AbCdEf002 (appended in current order).
      manager.reorder(['AbCdEf003', 'ghost-id', 'AbCdEf001']);
      expect(manager.list().map((entry) => entry.id)).toEqual([
        'AbCdEf003',
        'AbCdEf001',
        'AbCdEf002',
      ]);
    } finally {
      manager.onApplicationShutdown();
      database.$client.close();
    }
  });

  it('editSearch re-points to a new search id, keeping hits + settings (#1)', async () => {
    const { manager, database, wsEngines } = createManager();
    try {
      await manager.add('OldSearch1', { label: 'My search', autoBuy: true });
      wsEngines[0]?.callbacks?.onStatus('active', 'connected');
      wsEngines[0]?.callbacks?.onListings([
        {
          listingId: 'h1',
          searchId: 'OldSearch1',
          itemName: 'Storm Veil',
          price: null,
          seller: 'seller#1',
          hideoutToken: 'jwt',
          item: null,
          detectedAt: '2026-06-12T10:00:00.000Z',
        },
      ]);

      const info = await manager.editSearch('OldSearch1', 'NewSearch2', { label: 'Renamed' });
      expect(info.id).toBe('NewSearch2');
      expect(info.label).toBe('Renamed');
      expect(info.autoBuy).toBe(true); // settings carried over

      // The row is re-keyed (old id gone, new id present)…
      const rows = database.$client.prepare('SELECT id FROM searches').all() as Array<{
        id: string;
      }>;
      expect(rows).toEqual([{ id: 'NewSearch2' }]);
      // …and the hit history is KEPT — re-pointed to the new id, not cascade-deleted.
      const hitRows = database.$client.prepare('SELECT search_id FROM hits').all() as Array<{
        search_id: string;
      }>;
      expect(hitRows).toEqual([{ search_id: 'NewSearch2' }]);
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
        ALLOW_GATE,
        new LiveOfferRegistry(loadConfig({})),
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
        ALLOW_GATE,
        new LiveOfferRegistry(loadConfig({})),
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
