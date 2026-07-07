import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  offerKey,
  type ExportedSearchEntry,
  type Listing,
  type ManagedSearch,
} from '@poe-sniper/shared';
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
import { HitDecoratorRegistry } from './hit-decorator.js';
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

  const hitDecorators = new HitDecoratorRegistry();
  const manager = new SearchManager(
    config,
    database,
    registry,
    tradeApi,
    realtimeBus,
    options.guard ?? ARMED_GUARD,
    options.gate ?? ALLOW_GATE,
    new LiveOfferRegistry(config),
    hitDecorators,
  );
  return {
    manager,
    database,
    tradeApi,
    events,
    executeSearch,
    wsEngines,
    hitDecorators,
    realtimeBus,
  };
}

/** Mirror of ImportService's rebuild step: exported deal config → fresh pending runtime. */
function asImportEntries(exported: ExportedSearchEntry[]): ManagedSearch[] {
  return exported.map((entry) => ({
    ...entry,
    dealWatch:
      entry.dealWatch === null
        ? null
        : {
            ...entry.dealWatch,
            watchId: randomUUID(),
            baseline: null,
            capBaseline: null,
            capExalted: null,
            derivedCreatedAt: null,
            status: 'pending-derive' as const,
            nextRefreshAt: null,
            divinePriceExalted: null,
          },
  }));
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

  it('enabling detection drips searches out one-by-one with a stagger gap (#31)', async () => {
    vi.useFakeTimers();
    // Gap = max(DETECTION_STAGGER_MS 500, guard-safe 60s/12·1.2 = 6000) = 6000ms —
    // the drip must stay under GUARD_MAX_WS_CONNECTS_PER_MINUTE, not just spread.
    const { manager, database, wsEngines } = createManager();
    try {
      // Pause first so add() registers the searches without starting their engines.
      manager.setDetectionPaused(true);
      await manager.add('AbCdEf201', {});
      await manager.add('AbCdEf202', {});
      await manager.add('AbCdEf203', {});
      expect(wsEngines).toHaveLength(0);

      // Resume → the first start runs synchronously; the rest drip 6s apart
      // instead of firing three ws-connects at once.
      manager.setDetectionPaused(false);
      expect(wsEngines).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(5999);
      expect(wsEngines).toHaveLength(1); // still within the gap
      await vi.advanceTimersByTimeAsync(1);
      expect(wsEngines).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(6000);
      expect(wsEngines).toHaveLength(3);
    } finally {
      vi.useRealTimers();
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
        new HitDecoratorRegistry(),
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
        new HitDecoratorRegistry(),
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
      wsEngines[0]?.callbacks?.onStatus('degraded', 'ws-reconnecting');
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
      expect(manager.importSearches(asImportEntries(exported), [], 'skip')).toEqual({
        imported: 0,
        skipped: 1,
        errors: [],
      });

      // A different id is restored straight from the export shape (no resolveQuery).
      const result = manager.importSearches(
        asImportEntries([{ ...first, id: 'NewSearch1', label: 'Restored' }]),
        [],
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

      manager.reorder([
        { kind: 'search', id: 'AbCdEf003' },
        { kind: 'search', id: 'AbCdEf001' },
        { kind: 'search', id: 'AbCdEf002' },
      ]);
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
        new HitDecoratorRegistry(),
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
      manager.reorder([
        { kind: 'search', id: 'AbCdEf003' },
        { kind: 'search', id: 'ghost-id' },
        { kind: 'search', id: 'AbCdEf001' },
      ]);
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

  it('refreshListing re-fetches a fresh token by id and matches by offerKey (tier 1) (#30)', async () => {
    const { manager, tradeApi, database } = createManager();
    try {
      await manager.add('AbCdEf001', {});
      const target: Listing = {
        listingId: 'fresh-id',
        searchId: 'AbCdEf001',
        itemName: 'Storm Veil',
        price: { amount: 5, currency: 'divine' },
        seller: 'seller#1',
        hideoutToken: `tok-${'x'.repeat(30)}`,
        item: null,
        detectedAt: '2026-06-30T00:00:00.000Z',
      };
      // Arg-based mock: the tier-1 fetch (by the old id) resolves the offer with a token.
      vi.mocked(tradeApi.fetchListings).mockImplementation((_search, ids) =>
        Promise.resolve(ids.includes('old-id') ? [target] : []),
      );
      const result = await manager.refreshListing('AbCdEf001', 'old-id', offerKey(target));
      expect(result).toBe(target);
    } finally {
      manager.onApplicationShutdown();
      database.$client.close();
    }
  });

  it('refreshListing falls back to a re-search matched by offerKey (tier 2) (#30)', async () => {
    const { manager, tradeApi, executeSearch, database } = createManager();
    try {
      await manager.add('AbCdEf001', {});
      const target: Listing = {
        listingId: 'reserved-id',
        searchId: 'AbCdEf001',
        itemName: 'Storm Veil',
        price: { amount: 5, currency: 'divine' },
        seller: 'seller#1',
        hideoutToken: `tok-${'y'.repeat(30)}`,
        item: null,
        detectedAt: '2026-06-30T00:00:00.000Z',
      };
      // Tier 1 (old id) finds nothing; the re-search returns a new id whose fetch matches.
      vi.mocked(tradeApi.fetchListings).mockImplementation((_search, ids) =>
        Promise.resolve(ids.includes('reserved-id') ? [target] : []),
      );
      executeSearch.mockResolvedValue({ ids: ['reserved-id'], total: 1, rateLimited: false });
      const result = await manager.refreshListing('AbCdEf001', 'old-id', offerKey(target));
      expect(result).toBe(target);
    } finally {
      manager.onApplicationShutdown();
      database.$client.close();
    }
  });

  it('refreshListing returns null when the offer is gone (#30)', async () => {
    const { manager, database } = createManager();
    try {
      await manager.add('AbCdEf001', {});
      // Default mocks: tier-1 fetch [] and re-search ids [] → no match.
      const result = await manager.refreshListing('AbCdEf001', 'old-id', 'no-such-offer');
      expect(result).toBeNull();
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
        new HitDecoratorRegistry(),
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

  it('rooms: membership + two-scope order persist across a reload (#33)', async () => {
    const { manager, database } = createManager();
    try {
      await manager.add('AbCdEf001', { label: 'A' });
      await manager.add('AbCdEf002', { label: 'B' });
      await manager.add('AbCdEf003', { label: 'C' });
      const created = manager.createRoom('Helmets');
      const roomId = created.rooms[0]!.id;

      // [room(C, A), B] — the room block also sets the flattened poll order.
      const view = manager.reorder([
        { kind: 'room', id: roomId, searchIds: ['AbCdEf003', 'AbCdEf001'] },
        { kind: 'search', id: 'AbCdEf002' },
      ]);
      expect(view.layout).toEqual([
        { kind: 'room', id: roomId, searchIds: ['AbCdEf003', 'AbCdEf001'] },
        { kind: 'search', id: 'AbCdEf002' },
      ]);
      expect(view.searches.map((entry) => entry.id)).toEqual([
        'AbCdEf003',
        'AbCdEf001',
        'AbCdEf002',
      ]);
      expect(view.searches[0]?.roomId).toBe(roomId);
      manager.updateRoom(roomId, { collapsed: true });
      manager.onApplicationShutdown();

      const reloaded = new SearchManager(
        loadConfig({}),
        database,
        [],
        { resolveQuery: vi.fn() } as unknown as TradeApiClient,
        new RealtimeBus(),
        ARMED_GUARD,
        ALLOW_GATE,
        new LiveOfferRegistry(loadConfig({})),
        new HitDecoratorRegistry(),
      );
      reloaded.onApplicationBootstrap();
      try {
        const restored = reloaded.view();
        expect(restored.layout).toEqual(view.layout);
        expect(restored.searches.map((entry) => entry.id)).toEqual([
          'AbCdEf003',
          'AbCdEf001',
          'AbCdEf002',
        ]);
        expect(restored.rooms).toHaveLength(1);
        expect(restored.rooms[0]).toMatchObject({ id: roomId, name: 'Helmets', collapsed: true });
      } finally {
        reloaded.onApplicationShutdown();
      }
    } finally {
      manager.onApplicationShutdown();
      database.$client.close();
    }
  });

  it('an empty room keeps its top-level slot across a reload (#33)', async () => {
    const { manager, database } = createManager();
    try {
      await manager.add('AbCdEf001', {});
      await manager.add('AbCdEf002', {});
      const roomId = manager.createRoom('Empty room').rooms[0]!.id;
      manager.reorder([
        { kind: 'search', id: 'AbCdEf001' },
        { kind: 'room', id: roomId, searchIds: [] },
        { kind: 'search', id: 'AbCdEf002' },
      ]);
      manager.onApplicationShutdown();

      const reloaded = new SearchManager(
        loadConfig({}),
        database,
        [],
        { resolveQuery: vi.fn() } as unknown as TradeApiClient,
        new RealtimeBus(),
        ARMED_GUARD,
        ALLOW_GATE,
        new LiveOfferRegistry(loadConfig({})),
        new HitDecoratorRegistry(),
      );
      reloaded.onApplicationBootstrap();
      try {
        expect(reloaded.view().layout).toEqual([
          { kind: 'search', id: 'AbCdEf001' },
          { kind: 'room', id: roomId, searchIds: [] },
          { kind: 'search', id: 'AbCdEf002' },
        ]);
      } finally {
        reloaded.onApplicationShutdown();
      }
    } finally {
      manager.onApplicationShutdown();
      database.$client.close();
    }
  });

  it('deleting a room with mode=release drops members in place, top-level (D-room-2)', async () => {
    const { manager, database } = createManager();
    try {
      await manager.add('AbCdEf001', {});
      await manager.add('AbCdEf002', {});
      await manager.add('AbCdEf003', {});
      const roomId = manager.createRoom('Helmets').rooms[0]!.id;
      manager.reorder([
        { kind: 'search', id: 'AbCdEf001' },
        { kind: 'room', id: roomId, searchIds: ['AbCdEf002'] },
        { kind: 'search', id: 'AbCdEf003' },
      ]);

      const view = manager.deleteRoom(roomId, 'release');
      expect(view.rooms).toEqual([]);
      expect(view.layout).toEqual([
        { kind: 'search', id: 'AbCdEf001' },
        { kind: 'search', id: 'AbCdEf002' },
        { kind: 'search', id: 'AbCdEf003' },
      ]);
      expect(view.searches.every((entry) => entry.roomId === null)).toBe(true);
      // Fully persisted: the room row is gone, memberships nulled.
      const roomCount = database.$client.prepare('SELECT COUNT(*) AS c FROM rooms').get() as {
        c: number;
      };
      expect(roomCount.c).toBe(0);
      const memberRows = database.$client
        .prepare('SELECT room_id FROM searches WHERE room_id IS NOT NULL')
        .all();
      expect(memberRows).toEqual([]);
    } finally {
      manager.onApplicationShutdown();
      database.$client.close();
    }
  });

  it('deleting a room with mode=delete-searches tears the members down (D-room-2)', async () => {
    const { manager, database, executeSearch } = createManager();
    try {
      await manager.add('AbCdEf001', {});
      await manager.add('AbCdEf002', {});
      const roomId = manager.createRoom('Helmets').rooms[0]!.id;
      manager.reorder([
        { kind: 'room', id: roomId, searchIds: ['AbCdEf001'] },
        { kind: 'search', id: 'AbCdEf002' },
      ]);

      const view = manager.deleteRoom(roomId, 'delete-searches');
      expect(view.searches.map((entry) => entry.id)).toEqual(['AbCdEf002']);
      const searchRows = database.$client.prepare('SELECT id FROM searches').all() as Array<{
        id: string;
      }>;
      expect(searchRows).toEqual([{ id: 'AbCdEf002' }]);
      // The deleted member no longer polls.
      executeSearch.mockClear();
      await manager.runSchedulerTick();
      await manager.runSchedulerTick();
      const tickedSearches = executeSearch.mock.calls.map(
        (call) => (call as unknown as [{ searchId: string }])[0].searchId,
      );
      expect(tickedSearches).not.toContain('AbCdEf001');
    } finally {
      manager.onApplicationShutdown();
      database.$client.close();
    }
  });

  it('reorder omitting a room member keeps it in its room (#33 race rules)', async () => {
    const context = createManager();
    try {
      await context.manager.add('AbCdEf001', {});
      await context.manager.add('AbCdEf002', {});
      const roomId = context.manager.createRoom('Helmets').rooms[0]!.id;
      context.manager.reorder([
        { kind: 'room', id: roomId, searchIds: ['AbCdEf001'] },
        { kind: 'search', id: 'AbCdEf002' },
      ]);
      // A stale client reorders only the ungrouped search — the member must stay roomed.
      const view = context.manager.reorder([{ kind: 'search', id: 'AbCdEf002' }]);
      expect(view.layout).toEqual([
        { kind: 'search', id: 'AbCdEf002' },
        { kind: 'room', id: roomId, searchIds: ['AbCdEf001'] },
      ]);
    } finally {
      context.manager.onApplicationShutdown();
      context.database.$client.close();
    }
  });

  it('room master switch disables every member at once and persists (D-room-1)', async () => {
    const { manager, database, executeSearch } = createManager();
    try {
      await manager.add('AbCdEf001', {});
      await manager.add('AbCdEf002', {});
      await manager.add('AbCdEf003', {});
      const roomId = manager.createRoom('Helmets').rooms[0]!.id;
      manager.reorder([
        { kind: 'room', id: roomId, searchIds: ['AbCdEf001', 'AbCdEf002'] },
        { kind: 'search', id: 'AbCdEf003' },
      ]);

      const view = manager.setRoomEnabled(roomId, false);
      const memberStates = view.searches.filter((entry) => entry.roomId === roomId);
      expect(memberStates.every((entry) => !entry.enabled && entry.status === 'stopped')).toBe(
        true,
      );
      // The non-member is untouched.
      expect(view.searches.find((entry) => entry.id === 'AbCdEf003')?.enabled).toBe(true);
      // Persisted.
      const rows = database.$client
        .prepare('SELECT id, enabled FROM searches ORDER BY id')
        .all() as Array<{ id: string; enabled: number }>;
      expect(rows).toEqual([
        { id: 'AbCdEf001', enabled: 0 },
        { id: 'AbCdEf002', enabled: 0 },
        { id: 'AbCdEf003', enabled: 1 },
      ]);
      // Disabled members poll no more.
      executeSearch.mockClear();
      await manager.runSchedulerTick();
      await manager.runSchedulerTick();
      const tickedSearches = executeSearch.mock.calls.map(
        (call) => (call as unknown as [{ searchId: string }])[0].searchId,
      );
      expect(tickedSearches).toEqual(['AbCdEf003', 'AbCdEf003']);
    } finally {
      manager.onApplicationShutdown();
      database.$client.close();
    }
  });

  it('room master switch re-enables members through the stagger drip, not a burst (D-room-1)', async () => {
    vi.useFakeTimers();
    const { manager, database, wsEngines } = createManager(); // derived gap = 6000ms (guard-safe)
    try {
      await manager.add('AbCdEf001', {});
      await manager.add('AbCdEf002', {});
      await manager.add('AbCdEf003', {});
      const roomId = manager.createRoom('Helmets').rooms[0]!.id;
      manager.reorder([{ kind: 'room', id: roomId, searchIds: ['AbCdEf001', 'AbCdEf002'] }]);
      manager.setRoomEnabled(roomId, false);
      const engineCountWhenOff = wsEngines.length;

      // Re-enable: the first member starts synchronously, the second drips one
      // guard-safe gap later — never two ws-connects in the same instant.
      manager.setRoomEnabled(roomId, true);
      expect(wsEngines.length).toBe(engineCountWhenOff + 1);
      await vi.advanceTimersByTimeAsync(5999);
      expect(wsEngines.length).toBe(engineCountWhenOff + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(wsEngines.length).toBe(engineCountWhenOff + 2);
    } finally {
      vi.useRealTimers();
      manager.onApplicationShutdown();
      database.$client.close();
    }
  });

  it('room master switch under global pause marks members PAUSED without starting engines', async () => {
    const { manager, database, wsEngines } = createManager();
    try {
      await manager.add('AbCdEf001', {});
      const roomId = manager.createRoom('Helmets').rooms[0]!.id;
      manager.reorder([{ kind: 'room', id: roomId, searchIds: ['AbCdEf001'] }]);
      manager.setRoomEnabled(roomId, false);
      manager.setDetectionPaused(true);
      const engineCountBefore = wsEngines.length;

      const view = manager.setRoomEnabled(roomId, true);
      const member = view.searches.find((entry) => entry.id === 'AbCdEf001')!;
      expect(member.enabled).toBe(true);
      expect(member.status).toBe('paused');
      expect(wsEngines.length).toBe(engineCountBefore); // nothing started
      // Global resume brings the member up.
      manager.setDetectionPaused(false);
      expect(manager.list().find((entry) => entry.id === 'AbCdEf001')?.status).toBe('active');
    } finally {
      manager.onApplicationShutdown();
      database.$client.close();
    }
  });

  it('archive stops detection, leaves the layout, and survives a reload (#35)', async () => {
    const { manager, database, executeSearch } = createManager();
    try {
      await manager.add('AbCdEf001', {});
      await manager.add('AbCdEf002', {});
      const roomId = manager.createRoom('Helmets').rooms[0]!.id;
      manager.reorder([
        { kind: 'room', id: roomId, searchIds: ['AbCdEf001'] },
        { kind: 'search', id: 'AbCdEf002' },
      ]);

      const archived = manager.update('AbCdEf001', { archived: true });
      expect(archived.archivedAt).not.toBeNull();
      expect(archived.status).toBe('stopped');
      expect(archived.enabled).toBe(true); // preserved for restore
      expect(archived.roomId).toBe(roomId); // membership preserved for restore
      // Out of the layout (the room shows empty) but still listed.
      const view = manager.view();
      expect(view.layout).toEqual([
        { kind: 'room', id: roomId, searchIds: [] },
        { kind: 'search', id: 'AbCdEf002' },
      ]);
      expect(view.searches.map((entry) => entry.id)).toContain('AbCdEf001');
      // No polling for the archived search.
      executeSearch.mockClear();
      await manager.runSchedulerTick();
      await manager.runSchedulerTick();
      const tickedSearches = executeSearch.mock.calls.map(
        (call) => (call as unknown as [{ searchId: string }])[0].searchId,
      );
      expect(tickedSearches).toEqual(['AbCdEf002', 'AbCdEf002']);
      manager.onApplicationShutdown();

      // Reload: still archived, still out of the layout, still listed.
      const reloaded = new SearchManager(
        loadConfig({}),
        database,
        [],
        { resolveQuery: vi.fn() } as unknown as TradeApiClient,
        new RealtimeBus(),
        ARMED_GUARD,
        ALLOW_GATE,
        new LiveOfferRegistry(loadConfig({})),
        new HitDecoratorRegistry(),
      );
      reloaded.onApplicationBootstrap();
      try {
        const restoredView = reloaded.view();
        expect(restoredView.layout).toEqual(view.layout);
        const entry = restoredView.searches.find((search) => search.id === 'AbCdEf001');
        expect(entry?.archivedAt).not.toBeNull();
        expect(entry?.status).toBe('stopped');
      } finally {
        reloaded.onApplicationShutdown();
      }
    } finally {
      manager.onApplicationShutdown();
      database.$client.close();
    }
  });

  it('restore re-arms detection and returns the search to its room (#35)', async () => {
    const { manager, database } = createManager();
    try {
      await manager.add('AbCdEf001', {});
      const roomId = manager.createRoom('Helmets').rooms[0]!.id;
      manager.reorder([{ kind: 'room', id: roomId, searchIds: ['AbCdEf001'] }]);
      manager.update('AbCdEf001', { archived: true });

      const restored = manager.update('AbCdEf001', { archived: false });
      expect(restored.archivedAt).toBeNull();
      expect(restored.status).toBe('active');
      expect(manager.view().layout).toEqual([
        { kind: 'room', id: roomId, searchIds: ['AbCdEf001'] },
      ]);
    } finally {
      manager.onApplicationShutdown();
      database.$client.close();
    }
  });

  it('deleting a room with delete-searches RELEASES its archived members (#35)', async () => {
    const { manager, database } = createManager();
    try {
      await manager.add('AbCdEf001', {});
      await manager.add('AbCdEf002', {});
      const roomId = manager.createRoom('Helmets').rooms[0]!.id;
      manager.reorder([{ kind: 'room', id: roomId, searchIds: ['AbCdEf001', 'AbCdEf002'] }]);
      manager.update('AbCdEf001', { archived: true });

      // delete-searches destroys the VISIBLE member only; the archived one
      // (invisible in the room UI) survives, released to no-room.
      const view = manager.deleteRoom(roomId, 'delete-searches');
      const survivors = view.searches.map((entry) => entry.id);
      expect(survivors).toEqual(['AbCdEf001']);
      expect(view.searches[0]?.roomId).toBeNull();
      expect(view.searches[0]?.archivedAt).not.toBeNull();
      const rows = database.$client.prepare('SELECT id, room_id FROM searches').all() as Array<{
        id: string;
        room_id: string | null;
      }>;
      expect(rows).toEqual([{ id: 'AbCdEf001', room_id: null }]);
    } finally {
      manager.onApplicationShutdown();
      database.$client.close();
    }
  });

  it('export/import round-trips the archived state without starting engines (#35)', async () => {
    const source = createManager();
    const target = createManager();
    try {
      await source.manager.add('AbCdEf001', {});
      source.manager.update('AbCdEf001', { archived: true });
      const exported = source.manager.exportSearches();
      expect(exported[0]?.archivedAt).not.toBeNull();

      target.executeSearch.mockClear();
      const result = target.manager.importSearches(asImportEntries(exported), [], 'skip');
      expect(result.imported).toBe(1);
      const imported = target.manager.list().find((entry) => entry.id === 'AbCdEf001');
      expect(imported?.archivedAt).toBe(exported[0]?.archivedAt);
      expect(imported?.status).toBe('stopped');
      await target.manager.runSchedulerTick();
      expect(target.executeSearch).not.toHaveBeenCalled();
    } finally {
      source.manager.onApplicationShutdown();
      source.database.$client.close();
      target.manager.onApplicationShutdown();
      target.database.$client.close();
    }
  });

  it('export/import round-trips rooms — matched by name, membership remapped (#33)', async () => {
    const source = createManager();
    const target = createManager();
    try {
      await source.manager.add('AbCdEf001', { label: 'Roomed' });
      await source.manager.add('AbCdEf002', { label: 'Loose' });
      const roomId = source.manager.createRoom('Helmets').rooms[0]!.id;
      source.manager.reorder([
        { kind: 'room', id: roomId, searchIds: ['AbCdEf001'] },
        { kind: 'search', id: 'AbCdEf002' },
      ]);

      const exportedSearches = source.manager.exportSearches();
      const exportedRooms = source.manager.exportRooms();
      expect(exportedRooms).toEqual([{ id: roomId, name: 'Helmets', collapsed: false }]);

      const result = target.manager.importSearches(
        asImportEntries(exportedSearches),
        exportedRooms,
        'skip',
      );
      expect(result).toEqual({ imported: 2, skipped: 0, errors: [] });
      const view = target.manager.view();
      const importedRoom = view.rooms[0]!;
      expect(importedRoom.name).toBe('Helmets');
      expect(importedRoom.id).not.toBe(roomId); // fresh id — file ids never leak
      expect(view.searches.find((entry) => entry.id === 'AbCdEf001')?.roomId).toBe(importedRoom.id);

      // Idempotent re-import: same name reused, no duplicate room.
      target.manager.importSearches(asImportEntries(exportedSearches), exportedRooms, 'replace');
      expect(target.manager.view().rooms).toHaveLength(1);
    } finally {
      source.manager.onApplicationShutdown();
      source.database.$client.close();
      target.manager.onApplicationShutdown();
      target.database.$client.close();
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
        new HitDecoratorRegistry(),
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

describe('deal-watch seam (plan 41)', () => {
  const DEAL_STATE = {
    watchId: 'w-test-1',
    mode: 'percent' as const,
    thresholdValue: 30,
    unit: 'exalted' as const,
    baselineSampleSize: 10,
    refreshIntervalMs: null,
    definition: { status: { option: 'securable' }, stats: [] },
    originalSearchId: 'AbCdEf111',
    originalPriceFilter: null,
    baseline: null,
    capBaseline: null,
    capExalted: 700,
    derivedCreatedAt: new Date().toISOString(),
    status: 'active' as const,
    nextRefreshAt: null,
    divinePriceExalted: null,
  };

  it('swapDealSearch keeps the list slot, re-points hits, and keeps both guards (F17a)', async () => {
    const { manager, database } = createManager();
    try {
      await manager.add('AbCdEf111', { label: 'first' });
      await manager.add('AbCdEf222', { label: 'middle' });
      await manager.add('AbCdEf333', { label: 'last' });
      manager.updateDealState('AbCdEf222', DEAL_STATE);
      database.$client
        .prepare(
          "INSERT INTO hits (search_id, listing_id, item_name, seller, detected_at) VALUES ('AbCdEf222', 'listing-1', 'Barrage', 's', '2026-07-05T00:00:00Z')",
        )
        .run();

      // Same-id swap: a no-op re-derive updates filters/state, never throws (content-addressed ids).
      const sameId = manager.swapDealSearch('AbCdEf222', {
        id: 'AbCdEf222',
        filters: { status: { option: 'securable' }, stats: [], marker: 'same-id' },
        dealWatch: { ...DEAL_STATE, capExalted: 650 },
      });
      expect(sameId.dealWatch?.capExalted).toBe(650);

      // Collision with ANOTHER watched row → 409, nothing mutated.
      expect(() =>
        manager.swapDealSearch('AbCdEf222', {
          id: 'AbCdEf333',
          filters: {},
          dealWatch: DEAL_STATE,
        }),
      ).toThrow('already watched');

      // Real swap: middle slot keeps its position, hits follow the row.
      manager.swapDealSearch('AbCdEf222', {
        id: 'NewDeal99',
        filters: { status: { option: 'securable' }, stats: [] },
        dealWatch: DEAL_STATE,
      });
      expect(manager.list().map((info) => info.id)).toEqual([
        'AbCdEf111',
        'NewDeal99',
        'AbCdEf333',
      ]);
      const rePointed = database.$client
        .prepare("SELECT search_id FROM hits WHERE listing_id = 'listing-1'")
        .get() as { search_id: string };
      expect(rePointed.search_id).toBe('NewDeal99');
    } finally {
      manager.onApplicationShutdown();
    }
  });

  it('a deal re-derive swap preserves the prior engine status — no pending flash (D-dw-20)', async () => {
    const { manager, realtimeBus } = createManager();
    const engineStatuses: string[] = [];
    realtimeBus.subscribe((event) => {
      if (event.type === 'engine-status') engineStatuses.push(event.status);
    });
    try {
      await manager.add('AbCdEf222', { label: 'deal row' });
      manager.updateDealState('AbCdEf222', DEAL_STATE);
      engineStatuses.length = 0;

      // A real re-derive swap (new id) must NOT publish a `pending` downgrade —
      // the carried status holds through the reconnect (onWsStatus takes over;
      // the new engines' own status is what the row ends on).
      manager.swapDealSearch('AbCdEf222', {
        id: 'NewDeal99',
        filters: { status: { option: 'securable' }, stats: [] },
        dealWatch: DEAL_STATE,
      });
      expect(engineStatuses).not.toContain('pending');
    } finally {
      manager.onApplicationShutdown();
    }
  });

  it('exports a deal row as the portable config subset — no watchId, no runtime state (F8/F17d)', async () => {
    const { manager } = createManager();
    try {
      await manager.add('AbCdEf111', { label: 'deal row' });
      manager.updateDealState('AbCdEf111', {
        ...DEAL_STATE,
        baseline: {
          amountExalted: 1000,
          sampleSize: 5,
          rawLowestExalted: 900,
          computedAt: '2026-07-05T00:00:00Z',
          listingsSeen: 10,
        },
      });
      const [exported] = manager.exportSearches();
      // Exactly the D-dw-10 subset: identity + runtime state stay machine-local.
      expect(exported?.dealWatch).toEqual({
        mode: 'percent',
        thresholdValue: 30,
        unit: 'exalted',
        baselineSampleSize: 10,
        refreshIntervalMs: null,
        definition: DEAL_STATE.definition,
        originalSearchId: 'AbCdEf111',
        originalPriceFilter: null,
      });
    } finally {
      manager.onApplicationShutdown();
    }
  });

  it('rejects a manual id edit while deal mode is on (F17b)', async () => {
    const { manager } = createManager();
    try {
      await manager.add('AbCdEf111', { label: 'deal row' });
      manager.updateDealState('AbCdEf111', DEAL_STATE);
      await expect(manager.editSearch('AbCdEf111', 'AbCdEf999', {})).rejects.toThrow(
        'managed by deal-watch',
      );
      // A label-only edit (same id) stays allowed.
      const relabeled = await manager.editSearch('AbCdEf111', 'AbCdEf111', { label: 'renamed' });
      expect(relabeled.label).toBe('renamed');
    } finally {
      manager.onApplicationShutdown();
    }
  });

  it('recordHits persists the deal column in the same tx and honors suppressAlert (F17c)', async () => {
    const { manager, database, wsEngines, hitDecorators, realtimeBus } = createManager();
    const published: string[] = [];
    realtimeBus.subscribe((event) => published.push(event.type));
    try {
      await manager.add('AbCdEf111', { label: 'deal row' });
      manager.updateDealState('AbCdEf111', DEAL_STATE);
      hitDecorators.register({
        decorate: (listing) => ({
          event: {
            type: 'deal',
            listing,
            deal: {
              baselineExalted: 1000,
              discountPercent: 40,
              discountExalted: 400,
              baselineStale: false,
              divinePriceExalted: null,
            },
          },
          updatedEvent: {
            type: 'deal-updated',
            listing,
            deal: {
              baselineExalted: 1000,
              discountPercent: 40,
              discountExalted: 400,
              baselineStale: false,
              divinePriceExalted: null,
            },
          },
          hitColumns: {
            deal: {
              baselineExalted: 1000,
              discountPercent: 40,
              discountExalted: 400,
              baselineStale: false,
              divinePriceExalted: null,
            },
          },
          // The cheap listing alerts; the expensive one is history-only.
          suppressAlert: (listing.price?.amount ?? 0) > 700,
        }),
      });

      const makeListing = (listingId: string, amount: number): Listing => ({
        listingId,
        searchId: 'AbCdEf111',
        itemName: `Gem ${listingId}`,
        price: { amount, currency: 'exalted' },
        seller: `seller-${listingId}`,
        hideoutToken: null,
        item: null,
        detectedAt: new Date().toISOString(),
      });
      wsEngines[0]!.callbacks!.onListings([
        makeListing('deal-1', 500),
        makeListing('quiet-1', 900),
      ]);

      const rows = database.$client
        .prepare('SELECT listing_id, deal FROM hits ORDER BY listing_id')
        .all() as Array<{ listing_id: string; deal: string | null }>;
      // BOTH listings persisted with the discount context in the same insert…
      expect(rows.map((row) => row.listing_id)).toEqual(['deal-1', 'quiet-1']);
      expect(rows.every((row) => row.deal !== null && row.deal.includes('40'))).toBe(true);
      // …but only the sub-cutoff one published an alert, as a `deal`, never a bare hit.
      expect(published).toContain('deal');
      expect(published).not.toContain('hit');
      expect(published.filter((type) => type === 'deal')).toHaveLength(1);
    } finally {
      manager.onApplicationShutdown();
    }
  });
});

describe('market-price seam (D-dw-14)', () => {
  const SNAPSHOT = {
    baseline: {
      amountExalted: 500,
      sampleSize: 5,
      rawLowestExalted: 480,
      computedAt: '2026-07-05T10:00:00Z',
      listingsSeen: 10,
    },
    divinePriceExalted: 714,
    nextCheckAt: '2026-07-05T11:00:00Z',
  };

  it('persists a snapshot, serves it on the runtime info, and clears it', async () => {
    const { manager, database } = createManager();
    try {
      await manager.add('AbCdEf111', { label: 'plain row' });
      manager.updateMarketSnapshot('AbCdEf111', SNAPSHOT);
      expect(manager.list()[0]?.marketPrice).toEqual(SNAPSHOT);
      const persisted = database.$client
        .prepare("SELECT market_price FROM searches WHERE id = 'AbCdEf111'")
        .get() as { market_price: string };
      expect(JSON.parse(persisted.market_price)).toEqual(SNAPSHOT);

      manager.updateMarketSnapshot('AbCdEf111', null);
      expect(manager.list()[0]?.marketPrice).toBeNull();
      // Unknown row: silent no-op — the check may finish after a delete.
      manager.updateMarketSnapshot('gone-row-1', SNAPSHOT);
    } finally {
      manager.onApplicationShutdown();
    }
  });

  it('a deal row composes marketPrice from its own baseline, not the column', async () => {
    const { manager } = createManager();
    try {
      await manager.add('AbCdEf111', { label: 'deal row' });
      manager.updateDealState('AbCdEf111', {
        watchId: 'w-market-1',
        mode: 'percent',
        thresholdValue: 30,
        unit: 'exalted',
        baselineSampleSize: 10,
        refreshIntervalMs: null,
        definition: {},
        originalSearchId: 'AbCdEf111',
        originalPriceFilter: null,
        baseline: SNAPSHOT.baseline,
        capBaseline: SNAPSHOT.baseline,
        capExalted: 350,
        derivedCreatedAt: '2026-07-05T10:00:00Z',
        status: 'active',
        nextRefreshAt: '2026-07-05T11:30:00Z',
        divinePriceExalted: 700,
      });
      const info = manager.list()[0];
      expect(info?.marketPrice).toEqual({
        baseline: SNAPSHOT.baseline,
        divinePriceExalted: 700,
        nextCheckAt: '2026-07-05T11:30:00Z',
      });
      expect(manager.marketCheckCandidates()).toHaveLength(0);
    } finally {
      manager.onApplicationShutdown();
    }
  });

  it('candidates exclude archived and disabled rows', async () => {
    const { manager } = createManager();
    try {
      await manager.add('AbCdEf111', { label: 'active' });
      await manager.add('AbCdEf222', { label: 'disabled' });
      await manager.add('AbCdEf333', { label: 'archived' });
      manager.update('AbCdEf222', { enabled: false });
      manager.update('AbCdEf333', { archived: true });
      expect(manager.marketCheckCandidates().map((candidate) => candidate.row.id)).toEqual([
        'AbCdEf111',
      ]);
    } finally {
      manager.onApplicationShutdown();
    }
  });
});
