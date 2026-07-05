import { ConflictException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DealWatchState, ManagedSearch } from '@poe-sniper/shared';
import { loadConfig } from '../config/env.js';
import type { SniperDatabase } from '../db/migrate.js';
import type { OutboundGuard } from '../guard/outbound-guard.js';
import type { TradeDataService } from '../price-check/trade-data.service.js';
import { HitDecoratorRegistry } from '../search/hit-decorator.js';
import type { SearchManager } from '../search/search-manager.js';
import type { RateLimitGovernor } from '../ratelimit/rate-limit-governor.js';
import { TradeApiClient, TradeApiError } from '../trade-api/trade-api.client.js';
import type { BaselineComputation, DealBaselineService } from './deal-baseline.service.js';
import type { DealHistoryService } from './deal-history.service.js';
import { DealWatchService, type DealWatchConfigInput } from './deal-watch.service.js';

const BASELINE = {
  amountExalted: 1000,
  sampleSize: 5,
  rawLowestExalted: 900,
  computedAt: new Date().toISOString(),
  listingsSeen: 10,
};

const OK_COMPUTATION: BaselineComputation = {
  kind: 'ok',
  baseline: BASELINE,
  ratesByApiId: new Map([['divine', 700]]),
  divinePriceExalted: 700,
};

const PERCENT_CONFIG: DealWatchConfigInput = {
  mode: 'percent',
  thresholdValue: 30,
  unit: 'exalted',
  baselineSampleSize: 10,
};

function makeRow(overrides: Partial<ManagedSearch> = {}): ManagedSearch {
  return {
    id: 'orig1234',
    realm: 'poe2',
    league: 'Runes of Aldur',
    label: 'Barrage gem',
    autoTravel: false,
    autoBuy: false,
    enabled: true,
    purchaseMode: null,
    filters: {
      type: 'Barrage',
      status: { option: 'securable' },
      filters: {
        trade_filters: { filters: { price: { max: 5, option: 'divine' } }, disabled: false },
      },
    },
    addedAt: new Date().toISOString(),
    roomId: null,
    archivedAt: null,
    dealWatch: null,
    ...overrides,
  };
}

function createHarness(
  options: {
    computation?: BaselineComputation;
    createdId?: string | null;
    resolveOriginal?: 'alive' | 'dead' | 'error';
    configOverrides?: Record<string, string>;
    paused?: boolean;
    guardTripped?: boolean;
    headroom?: number;
    /** Dictionary category returned for ANY name lookup (default: unknown item → null). */
    itemCategory?: string | null;
    /** True = every dictionary lookup rejects (offline / no cache / no session). */
    dictionaryUnavailable?: boolean;
    /** Pre-existing market snapshot on the row (D-dw-14 enable-reuse path). */
    marketSnapshot?: import('@poe-sniper/shared').MarketPriceSnapshot | null;
  } = {},
) {
  const row = makeRow();
  const store = { row };

  const pauseState = { paused: options.paused ?? false };
  const marketStore: { snapshot: import('@poe-sniper/shared').MarketPriceSnapshot | null } = {
    snapshot: options.marketSnapshot ?? null,
  };
  const searchManager = {
    getRow: vi.fn((searchId: string) => (store.row.id === searchId ? store.row : null)),
    dealModeRows: vi.fn(() => (store.row.dealWatch !== null ? [store.row] : [])),
    isWsConnected: vi.fn(() => true),
    isDetectionGloballyPaused: vi.fn(() => pauseState.paused),
    setDealRowCleanup: vi.fn(),
    getMarketSnapshot: vi.fn(() => marketStore.snapshot),
    updateMarketSnapshot: vi.fn(
      (_searchId: string, snapshot: import('@poe-sniper/shared').MarketPriceSnapshot | null) => {
        marketStore.snapshot = snapshot;
      },
    ),
    updateDealState: vi.fn((searchId: string, dealWatch: DealWatchState | null) => {
      store.row = { ...store.row, dealWatch };
      return {
        ...store.row,
        engine: null,
        status: 'active',
        statusDetail: null,
        hitCount: 0,
        lastHitAt: null,
      };
    }),
    swapDealSearch: vi.fn(
      (
        currentId: string,
        next: { id: string; filters: unknown; dealWatch: DealWatchState | null },
      ) => {
        store.row = { ...store.row, id: next.id, filters: next.filters, dealWatch: next.dealWatch };
        return {
          ...store.row,
          engine: null,
          status: 'active',
          statusDetail: null,
          hitCount: 0,
          lastHitAt: null,
        };
      },
    ),
    list: vi.fn(() => [
      {
        ...store.row,
        engine: null,
        status: 'active',
        statusDetail: null,
        hitCount: 0,
        lastHitAt: null,
      },
    ]),
  } as unknown as SearchManager;

  const resolveHolder = {
    /** One-shot override for the next resolveQuery call (returns its promise). */
    next: null as (() => Promise<unknown>) | null,
  };
  const tradeApi = {
    createSearch: vi.fn().mockResolvedValue({
      id: options.createdId === undefined ? 'derived99' : options.createdId,
      total: 3,
      rateLimited: options.createdId === null,
    }),
    resolveQuery: vi.fn().mockImplementation(() => {
      if (resolveHolder.next !== null) {
        const override = resolveHolder.next;
        resolveHolder.next = null;
        return override();
      }
      if (options.resolveOriginal === 'dead') {
        return Promise.reject(new TradeApiError(404, 'resolve: HTTP 404'));
      }
      if (options.resolveOriginal === 'error') {
        return Promise.reject(new TradeApiError(500, 'resolve: HTTP 500'));
      }
      return Promise.resolve({ type: 'Barrage' });
    }),
  } as unknown as TradeApiClient;

  const computationHolder = {
    value: options.computation ?? OK_COMPUTATION,
    /** One-shot hook fired synchronously inside the next computeBaseline call. */
    onCompute: null as (() => void) | null,
    /** One-shot rejection for the next computeBaseline call. */
    rejectWith: null as Error | null,
  };
  const baselineService = {
    computeBaseline: vi.fn().mockImplementation(() => {
      if (computationHolder.rejectWith !== null) {
        const failure = computationHolder.rejectWith;
        computationHolder.rejectWith = null;
        return Promise.reject(failure);
      }
      if (computationHolder.onCompute !== null) {
        const hook = computationHolder.onCompute;
        computationHolder.onCompute = null;
        hook();
      }
      return Promise.resolve(computationHolder.value);
    }),
  } as unknown as DealBaselineService;

  const historyService = {
    record: vi.fn(),
    recent: vi.fn().mockReturnValue([]),
    clearForWatch: vi.fn(),
  } as unknown as DealHistoryService;

  const tradeData = {
    categoryForItemName: vi
      .fn()
      .mockImplementation(() =>
        options.dictionaryUnavailable
          ? Promise.reject(new Error('dictionary refresh failed: offline'))
          : Promise.resolve(options.itemCategory ?? null),
      ),
  } as unknown as TradeDataService;

  const database = { run: vi.fn(), delete: vi.fn() } as unknown as SniperDatabase;
  const guard = { tripped: options.guardTripped ?? false } as unknown as OutboundGuard;
  const governor = {
    minHeadroom: vi.fn(() => options.headroom ?? 1),
  } as unknown as RateLimitGovernor;
  const registry = new HitDecoratorRegistry();
  const config = loadConfig({
    DETECTION_STAGGER_MS: '0',
    DEAL_REDERIVE_DEBOUNCE_MS: '0',
    ...options.configOverrides,
  });

  const service = new DealWatchService(
    config,
    database,
    searchManager,
    tradeApi,
    guard,
    governor,
    registry,
    baselineService,
    historyService,
    tradeData,
  );
  service.onModuleInit();
  return {
    service,
    store,
    searchManager,
    tradeApi,
    baselineService,
    historyService,
    tradeData,
    registry,
    computationHolder,
    resolveHolder,
    governor,
    pauseState,
  };
}

const sleepReal = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('DealWatchService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('enable: strips the price filter, derives a no-option capped search and swaps', async () => {
    const { service, store, tradeApi, searchManager, historyService } = createHarness();
    await service.applyConfig('orig1234', PERCENT_CONFIG);

    const createBody = (tradeApi.createSearch as ReturnType<typeof vi.fn>).mock.calls[0]![2] as {
      query: { filters: { trade_filters: { filters: { price: unknown } } } };
      sort: unknown;
    };
    // Cap = cutoff exactly (margin 0): 1000 × 0.70 = 700, NO currency option (D-dw-6).
    expect(createBody.query.filters.trade_filters.filters.price).toEqual({ max: 700 });
    expect(createBody.sort).toEqual({ price: 'asc' });

    expect(searchManager.swapDealSearch).toHaveBeenCalledOnce();
    expect(store.row.id).toBe('derived99');
    const state = store.row.dealWatch;
    expect(state?.status).toBe('active');
    expect(state?.capExalted).toBe(700);
    expect(state?.originalSearchId).toBe('orig1234');
    expect(state?.originalPriceFilter).toEqual({ max: 5, option: 'divine' });
    // The definition kept every non-price filter but lost the price cap.
    expect(JSON.stringify(state?.definition)).not.toContain('divine');
    expect(historyService.record).toHaveBeenCalledWith(state?.watchId, BASELINE, true);
  });

  it('enable with an insufficient market keeps the original query watched, no derive', async () => {
    const { service, store, tradeApi } = createHarness({
      computation: {
        kind: 'insufficient',
        listingsSeen: 3,
        usableCount: 1,
        ratesByApiId: null,
        divinePriceExalted: null,
      },
    });
    await service.applyConfig('orig1234', PERCENT_CONFIG);
    expect(tradeApi.createSearch).not.toHaveBeenCalled();
    expect(store.row.id).toBe('orig1234');
    expect(store.row.dealWatch?.status).toBe('insufficient-data');
  });

  it('enable beyond DEAL_MAX_WATCHES is rejected', async () => {
    const { service, searchManager } = createHarness({
      configOverrides: { DEAL_MAX_WATCHES: '1' },
    });
    // The single slot is taken by ANOTHER search's watch; enabling on this
    // (watch-free) row must hit the cap before any GGG traffic.
    const busyRow = makeRow({
      id: 'busy0001',
      dealWatch: {
        watchId: 'w-existing',
        mode: 'percent',
        thresholdValue: 10,
        unit: 'exalted',
        baselineSampleSize: 10,
        definition: {},
        originalSearchId: 'busy0001',
        originalPriceFilter: null,
        baseline: null,
        capBaseline: null,
        capExalted: null,
        derivedCreatedAt: null,
        status: 'active',
        nextRefreshAt: null,
        divinePriceExalted: null,
      },
    });
    (searchManager.dealModeRows as ReturnType<typeof vi.fn>).mockReturnValue([busyRow]);
    let caught: unknown = null;
    try {
      await service.applyConfig('orig1234', PERCENT_CONFIG);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConflictException);
    // Coded body only — the web maps it to i18n (review P2-2), prose never travels.
    expect((caught as ConflictException).getResponse()).toEqual({ code: 'deal-capped' });
  });

  it('a refused unsupported-item watch does not consume a cap slot (review P2-9)', async () => {
    const { service, store, searchManager } = createHarness({
      configOverrides: { DEAL_MAX_WATCHES: '1' },
    });
    // The only other deal row was REFUSED (unsupported-item): it never derives,
    // spends no budget and opens no socket — the single slot must stay free.
    const refusedRow = makeRow({
      id: 'refused1',
      dealWatch: {
        watchId: 'w-refused',
        mode: 'percent',
        thresholdValue: 10,
        unit: 'exalted',
        baselineSampleSize: 10,
        definition: {},
        originalSearchId: 'refused1',
        originalPriceFilter: null,
        baseline: null,
        capBaseline: null,
        capExalted: null,
        derivedCreatedAt: null,
        status: 'unsupported-item',
        nextRefreshAt: null,
        divinePriceExalted: null,
      },
    });
    // Dynamic: the live row must stay discoverable for the queue's post-await
    // revalidation (findByWatchId reads dealModeRows) while the refused row
    // occupies the list.
    (searchManager.dealModeRows as ReturnType<typeof vi.fn>).mockImplementation(() =>
      store.row.dealWatch !== null ? [refusedRow, store.row] : [refusedRow],
    );
    await service.applyConfig('orig1234', PERCENT_CONFIG);
    expect(store.row.id).toBe('derived99');
    expect(store.row.dealWatch?.status).toBe('active');
  });

  it('enable on a stack-priced item is refused: unsupported-item persisted, coded 409, zero GGG (W3)', async () => {
    const { service, store, tradeApi, baselineService, tradeData } = createHarness({
      itemCategory: 'currency',
    });
    let caught: unknown = null;
    try {
      await service.applyConfig('orig1234', PERCENT_CONFIG);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConflictException);
    expect((caught as ConflictException).getResponse()).toEqual({ code: 'deal-unsupported-item' });
    // The definition's top-level type went through the dictionary lookup…
    expect(tradeData.categoryForItemName).toHaveBeenCalledWith('Barrage');
    // …the refusal persisted, and the ORIGINAL query keeps watching: no
    // baseline compute, no derive POST, id untouched.
    expect(store.row.dealWatch?.status).toBe('unsupported-item');
    expect(store.row.id).toBe('orig1234');
    expect(baselineService.computeBaseline).not.toHaveBeenCalled();
    expect(tradeApi.createSearch).not.toHaveBeenCalled();
  });

  it('an unavailable dictionary never blocks an enable — warn + proceed (W3)', async () => {
    const { service, store } = createHarness({ dictionaryUnavailable: true });
    await service.applyConfig('orig1234', PERCENT_CONFIG);
    expect(store.row.id).toBe('derived99');
    expect(store.row.dealWatch?.status).toBe('active');
  });

  it('a non-stackable category proceeds through the gate (W3)', async () => {
    const { service, store, tradeData } = createHarness({ itemCategory: 'weapon' });
    await service.applyConfig('orig1234', PERCENT_CONFIG);
    expect(tradeData.categoryForItemName).toHaveBeenCalledWith('Barrage');
    expect(store.row.id).toBe('derived99');
    expect(store.row.dealWatch?.status).toBe('active');
  });

  it('a refused unsupported-item watch never refreshes or derives afterwards (W3)', async () => {
    const { service, store, baselineService, tradeApi } = createHarness({
      itemCategory: 'currency',
    });
    await service.applyConfig('orig1234', PERCENT_CONFIG).catch(() => {});
    expect(store.row.dealWatch?.status).toBe('unsupported-item');
    // A manual refresh reaching the queue is a deliberate no-op for it.
    const result = await service.manualRefresh(store.row.id);
    expect(result.kind).toBe('ok');
    expect(store.row.dealWatch?.status).toBe('unsupported-item');
    expect(baselineService.computeBaseline).not.toHaveBeenCalled();
    expect(tradeApi.createSearch).not.toHaveBeenCalled();
  });

  it('refresh with drift beyond the threshold re-derives with the fresh cap', async () => {
    const { service, store, searchManager, tradeApi, historyService, computationHolder } =
      createHarness();
    await service.applyConfig('orig1234', PERCENT_CONFIG);
    (tradeApi.createSearch as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'derived100',
      total: 1,
      rateLimited: false,
    });
    // capBaseline is 1000; a 900 baseline is a 10% drift > 5% default.
    (searchManager.swapDealSearch as ReturnType<typeof vi.fn>).mockClear();
    const drifted = { ...BASELINE, amountExalted: 900 };
    computationHolder.value = { ...OK_COMPUTATION, baseline: drifted };

    const result = await service.manualRefresh(store.row.id);
    expect(result.kind).toBe('ok');
    expect(searchManager.swapDealSearch).toHaveBeenCalledOnce();
    expect(store.row.id).toBe('derived100');
    expect(store.row.dealWatch?.capExalted).toBe(630); // 900 × 0.70
    expect(historyService.record).toHaveBeenLastCalledWith(
      store.row.dealWatch?.watchId,
      drifted,
      true,
    );
  });

  it('refresh without drift persists the newest baseline and does NOT re-derive', async () => {
    const { service, store, searchManager, historyService, computationHolder } = createHarness();
    await service.applyConfig('orig1234', PERCENT_CONFIG);
    (searchManager.swapDealSearch as ReturnType<typeof vi.fn>).mockClear();
    const nudged = { ...BASELINE, amountExalted: 1020 }; // 2% < 5% drift
    computationHolder.value = { ...OK_COMPUTATION, baseline: nudged };

    await service.manualRefresh(store.row.id);
    expect(searchManager.swapDealSearch).not.toHaveBeenCalled();
    // R3 intent: the persisted baseline is ALWAYS the newest — discounts stay live.
    expect(store.row.dealWatch?.baseline?.amountExalted).toBe(1020);
    expect(store.row.dealWatch?.capBaseline?.amountExalted).toBe(1000);
    expect(historyService.record).toHaveBeenLastCalledWith(
      store.row.dealWatch?.watchId,
      nudged,
      false,
    );
  });

  it('manual refresh honors the per-watch cooldown', async () => {
    const { service, store } = createHarness();
    await service.applyConfig('orig1234', PERCENT_CONFIG);
    const first = await service.manualRefresh(store.row.id);
    expect(first.kind).toBe('ok');
    const second = await service.manualRefresh(store.row.id);
    expect(second.kind).toBe('cooldown');
  });

  it('derive-conflict: a swap collision surfaces as status, not a crash', async () => {
    const { service, store, searchManager } = createHarness();
    (searchManager.swapDealSearch as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new ConflictException('already watched');
    });
    await service.applyConfig('orig1234', PERCENT_CONFIG);
    expect(store.row.dealWatch?.status).toBe('derive-conflict');
  });

  it('disable swaps back to the still-alive original id and clears history', async () => {
    const { service, store, searchManager, historyService } = createHarness({
      resolveOriginal: 'alive',
    });
    await service.applyConfig('orig1234', PERCENT_CONFIG);
    const watchId = store.row.dealWatch?.watchId;
    expect(store.row.id).toBe('derived99');

    await service.applyConfig('derived99', null);
    expect(store.row.id).toBe('orig1234');
    expect(store.row.dealWatch).toBeNull();
    // The original price filter came back with the restore.
    expect(JSON.stringify(store.row.filters)).toContain('divine');
    expect(historyService.clearForWatch).toHaveBeenCalledWith(watchId);
    expect(searchManager.swapDealSearch).toHaveBeenLastCalledWith(
      'derived99',
      expect.objectContaining({ id: 'orig1234', dealWatch: null }),
    );
  });

  it('disable with a dead original id re-mints the restored search', async () => {
    const { service, store, tradeApi } = createHarness({ resolveOriginal: 'dead' });
    await service.applyConfig('orig1234', PERCENT_CONFIG);
    (tradeApi.createSearch as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'reborn777',
      total: 0,
      rateLimited: false,
    });
    await service.applyConfig('derived99', null);
    expect(store.row.id).toBe('reborn777');
    expect(store.row.dealWatch).toBeNull();
    const restoreBody = (tradeApi.createSearch as ReturnType<typeof vi.fn>).mock.calls.at(
      -1,
    )![2] as {
      sort: unknown;
    };
    // A restored hand-made search sorts newest-first like the trade site default.
    expect(restoreBody.sort).toEqual({ indexed: 'desc' });
  });

  it('disable with a failing restore keeps the watch in restore-failed', async () => {
    const { service, store } = createHarness({ resolveOriginal: 'error' });
    await service.applyConfig('orig1234', PERCENT_CONFIG);
    await service.applyConfig('derived99', null);
    expect(store.row.dealWatch?.status).toBe('restore-failed');
    expect(store.row.id).toBe('derived99');
  });

  it('enable while globally paused settles immediately as pending-derive, zero GGG (F1/F17g)', async () => {
    const { service, store, tradeApi, baselineService } = createHarness({ paused: true });
    const info = await service.applyConfig('orig1234', PERCENT_CONFIG);
    // The request RESOLVED (no hang) with the persisted pending state…
    expect(info.id).toBe('orig1234');
    expect(store.row.dealWatch?.status).toBe('pending-derive');
    // …and the paused queue spent nothing against GGG (hard rule: pause = zero traffic).
    expect(baselineService.computeBaseline).not.toHaveBeenCalled();
    expect(tradeApi.createSearch).not.toHaveBeenCalled();
  });

  it('enable while the guard is tripped settles as pending-derive, zero GGG (F1/F17g)', async () => {
    const { service, store, tradeApi, baselineService } = createHarness({ guardTripped: true });
    await service.applyConfig('orig1234', PERCENT_CONFIG);
    expect(store.row.dealWatch?.status).toBe('pending-derive');
    expect(baselineService.computeBaseline).not.toHaveBeenCalled();
    expect(tradeApi.createSearch).not.toHaveBeenCalled();
  });

  it('manual refresh declines with explicit codes for paused/tripped/archived/disabled (F22)', async () => {
    const paused = createHarness();
    await paused.service.applyConfig('orig1234', PERCENT_CONFIG);
    paused.pauseState.paused = true;
    expect(await paused.service.manualRefresh(paused.store.row.id)).toEqual({
      kind: 'declined',
      code: 'paused',
    });
    paused.pauseState.paused = false;

    paused.store.row = { ...paused.store.row, archivedAt: new Date().toISOString() };
    expect(await paused.service.manualRefresh(paused.store.row.id)).toEqual({
      kind: 'declined',
      code: 'archived',
    });
    paused.store.row = { ...paused.store.row, archivedAt: null, enabled: false };
    expect(await paused.service.manualRefresh(paused.store.row.id)).toEqual({
      kind: 'declined',
      code: 'disabled',
    });
  });

  it('budget-low enable stays pending-derive with a SHORT retry horizon (F17e/F26)', async () => {
    const { service, store, tradeApi } = createHarness({
      computation: { kind: 'budget-low' },
    });
    await service.applyConfig('orig1234', PERCENT_CONFIG);
    expect(tradeApi.createSearch).not.toHaveBeenCalled();
    const state = store.row.dealWatch;
    expect(state?.status).toBe('pending-derive');
    // Backoff, not a full interval: strictly sooner than half the refresh cadence.
    const retryInMs = Date.parse(state!.nextRefreshAt!) - Date.now();
    expect(retryInMs).toBeGreaterThan(0);
    expect(retryInMs).toBeLessThan(3_600_000 * 0.5);
  });

  it('a non-429 GGG failure sets derive-failed and backs off — no retry storm (F4)', async () => {
    const { service, store, baselineService } = createHarness();
    await service.applyConfig('orig1234', PERCENT_CONFIG);
    (baselineService.computeBaseline as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new TradeApiError(503, 'price search: HTTP 503'),
    );
    await service.manualRefresh(store.row.id);
    const state = store.row.dealWatch;
    expect(state?.status).toBe('derive-failed');
    const retryInMs = Date.parse(state!.nextRefreshAt!) - Date.now();
    expect(retryInMs).toBeGreaterThan(0);
    expect(retryInMs).toBeLessThan(3_600_000 * 0.5);
  });

  it('bails after the baseline await when the id changed under the job (F17e)', async () => {
    const { service, store, tradeApi, computationHolder } = createHarness();
    await service.applyConfig('orig1234', PERCENT_CONFIG);
    (tradeApi.createSearch as ReturnType<typeof vi.fn>).mockClear();
    const stateBefore = store.row.dealWatch;
    computationHolder.onCompute = () => {
      // A concurrent actor re-points the row while the baseline call is in flight.
      store.row = { ...store.row, id: 'hijacked1' };
    };
    await service.manualRefresh('derived99');
    // The job saw the moved world and wrote/derived NOTHING.
    expect(tradeApi.createSearch).not.toHaveBeenCalled();
    expect(store.row.dealWatch).toEqual(stateBefore);
  });

  it('same-cap re-derive short-circuits without a POST and re-validates the id age (F5/F17f)', async () => {
    const { service, store, tradeApi, searchManager } = createHarness();
    await service.applyConfig('orig1234', PERCENT_CONFIG);
    const createdAtAfterEnable = store.row.dealWatch?.derivedCreatedAt;
    (tradeApi.createSearch as ReturnType<typeof vi.fn>).mockClear();
    (searchManager.swapDealSearch as ReturnType<typeof vi.fn>).mockClear();
    await sleepReal(5);

    // Re-derive forced by a threshold edit landing on the SAME value → same cap.
    await service.applyConfig(store.row.id, PERCENT_CONFIG);
    await vi.waitFor(() => {
      // No POST, no swap — content-addressed ids make it a no-op…
      expect(tradeApi.createSearch).not.toHaveBeenCalled();
      expect(searchManager.swapDealSearch).not.toHaveBeenCalled();
      // …but the id counts as re-validated: the age clock resets (F5).
      expect(store.row.dealWatch?.derivedCreatedAt).not.toBe(createdAtAfterEnable);
    });
  });

  it('a drift re-derive is declined below the headroom reserve — old cap keeps running (F13)', async () => {
    const { service, store, tradeApi, governor, computationHolder } = createHarness();
    await service.applyConfig('orig1234', PERCENT_CONFIG);
    (tradeApi.createSearch as ReturnType<typeof vi.fn>).mockClear();
    (governor.minHeadroom as ReturnType<typeof vi.fn>).mockReturnValue(0.1);
    computationHolder.value = { ...OK_COMPUTATION, baseline: { ...BASELINE, amountExalted: 500 } };

    await service.manualRefresh(store.row.id);
    expect(tradeApi.createSearch).not.toHaveBeenCalled();
    expect(store.row.dealWatch?.capExalted).toBe(700); // the old cap survived
  });

  it('disable while paused parks as restore-pending with zero GGG (F14)', async () => {
    const harness = createHarness();
    await harness.service.applyConfig('orig1234', PERCENT_CONFIG);
    (harness.tradeApi.resolveQuery as ReturnType<typeof vi.fn>).mockClear();
    harness.pauseState.paused = true;

    const info = await harness.service.applyConfig(harness.store.row.id, null);
    expect(info.id).toBe('derived99');
    expect(harness.store.row.dealWatch?.status).toBe('restore-pending');
    expect(harness.tradeApi.resolveQuery).not.toHaveBeenCalled();
    expect(harness.store.row.dealWatch).not.toBeNull();
  });

  it('disable tolerates a concurrent re-derive swapping the id mid-restore (F6)', async () => {
    const { service, store, searchManager, resolveHolder } = createHarness();
    await service.applyConfig('orig1234', PERCENT_CONFIG);
    let resolveRestore: (value: unknown) => void = () => {};
    resolveHolder.next = () =>
      new Promise((resolve) => {
        resolveRestore = resolve;
      });
    const disablePromise = service.applyConfig('derived99', null);
    await sleepReal(1);
    // An in-flight re-derive lands while the restore resolves the original id.
    store.row = { ...store.row, id: 'derived100' };
    resolveRestore({ type: 'Barrage' });
    await disablePromise; // must not throw (was: 500 + deal left enabled)
    expect(store.row.dealWatch).toBeNull();
    expect(searchManager.swapDealSearch).toHaveBeenLastCalledWith(
      'derived100',
      expect.objectContaining({ id: 'orig1234', dealWatch: null }),
    );
  });

  it('boot parks watches beyond DEAL_MAX_WATCHES as capped and never derives them (F3)', () => {
    const { service, searchManager } = createHarness({
      configOverrides: { DEAL_MAX_WATCHES: '1' },
    });
    const watchState = (watchId: string): DealWatchState => ({
      watchId,
      mode: 'percent',
      thresholdValue: 30,
      unit: 'exalted',
      baselineSampleSize: 10,
      definition: {},
      originalSearchId: 'x',
      originalPriceFilter: null,
      baseline: null,
      capBaseline: null,
      capExalted: null,
      derivedCreatedAt: null,
      status: 'pending-derive',
      nextRefreshAt: null,
      divinePriceExalted: null,
    });
    const first = makeRow({ id: 'first111', dealWatch: watchState('w-1') });
    const second = makeRow({ id: 'second22', dealWatch: watchState('w-2') });
    const updates: Array<{ searchId: string; status: string | undefined }> = [];
    (searchManager.dealModeRows as ReturnType<typeof vi.fn>).mockReturnValue([first, second]);
    (searchManager.updateDealState as ReturnType<typeof vi.fn>).mockImplementation(
      (searchId: string, dealWatch: DealWatchState | null) => {
        updates.push({ searchId, status: dealWatch?.status });
        return { id: searchId } as never;
      },
    );
    (searchManager.getRow as ReturnType<typeof vi.fn>).mockImplementation(
      (searchId: string) => [first, second].find((row) => row.id === searchId) ?? null,
    );

    service.onApplicationBootstrap();
    service.onApplicationShutdown();
    expect(updates).toContainEqual({ searchId: 'second22', status: 'capped' });
    expect(updates.filter((update) => update.searchId === 'first111')).toEqual([]);
  });

  it('threshold edit updates config immediately and re-derives after the debounce', async () => {
    vi.useFakeTimers();
    const { service, store, searchManager } = createHarness({
      configOverrides: { DEAL_REDERIVE_DEBOUNCE_MS: '5000' },
    });
    const enablePromise = service.applyConfig('orig1234', PERCENT_CONFIG);
    await vi.runAllTimersAsync();
    await enablePromise;
    (searchManager.swapDealSearch as ReturnType<typeof vi.fn>).mockClear();

    await service.applyConfig(store.row.id, {
      mode: 'percent',
      thresholdValue: 40,
      unit: 'exalted',
      baselineSampleSize: 10,
    });
    expect(store.row.dealWatch?.thresholdValue).toBe(40);
    expect(searchManager.swapDealSearch).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();
    // Debounce fired → re-derive queued + processed: cap now 1000 × 0.60.
    expect(store.row.dealWatch?.capExalted).toBe(600);
  });

  it('enable reuses a fresh market snapshot: no baseline GGG spend, snapshot cleared (D-dw-14)', async () => {
    const freshSnapshot = {
      baseline: {
        amountExalted: 1000,
        sampleSize: 6,
        rawLowestExalted: 950,
        computedAt: new Date().toISOString(),
        listingsSeen: 10,
      },
      divinePriceExalted: 714,
      nextCheckAt: null,
    };
    const { service, store, baselineService, searchManager, tradeApi } = createHarness({
      marketSnapshot: freshSnapshot,
    });
    await service.applyConfig('orig1234', PERCENT_CONFIG);
    // Baseline came from the snapshot — the only GGG spend is the derive POST.
    expect(baselineService.computeBaseline).not.toHaveBeenCalled();
    expect(tradeApi.createSearch).toHaveBeenCalledOnce();
    expect(store.row.dealWatch?.baseline?.amountExalted).toBe(1000);
    expect(store.row.dealWatch?.status).toBe('active');
    // The market snapshot column cleared — the deal baseline owns display now.
    expect(searchManager.updateMarketSnapshot).toHaveBeenCalledWith('orig1234', null);
  });

  it('enable ignores a STALE market snapshot and computes a fresh baseline', async () => {
    const staleSnapshot = {
      baseline: {
        amountExalted: 1234,
        sampleSize: 6,
        rawLowestExalted: 950,
        computedAt: new Date(Date.now() - 3_600_000).toISOString(),
        listingsSeen: 10,
      },
      divinePriceExalted: 714,
      nextCheckAt: null,
    };
    const { service, store, baselineService } = createHarness({ marketSnapshot: staleSnapshot });
    await service.applyConfig('orig1234', PERCENT_CONFIG);
    expect(baselineService.computeBaseline).toHaveBeenCalledOnce();
    expect(store.row.dealWatch?.baseline?.amountExalted).toBe(1000);
  });

  it('disable hands the last deal baseline back as the market snapshot (D-dw-14)', async () => {
    const { service, store, searchManager } = createHarness({ resolveOriginal: 'alive' });
    await service.applyConfig('orig1234', PERCENT_CONFIG);
    (searchManager.updateMarketSnapshot as ReturnType<typeof vi.fn>).mockClear();
    await service.applyConfig(store.row.id, null);
    expect(store.row.dealWatch).toBeNull();
    const snapshotCalls = (searchManager.updateMarketSnapshot as ReturnType<typeof vi.fn>).mock
      .calls as Array<[string, import('@poe-sniper/shared').MarketPriceSnapshot | null]>;
    const handback = snapshotCalls[snapshotCalls.length - 1];
    expect(handback?.[0]).toBe('orig1234');
    expect(handback?.[1]?.baseline.amountExalted).toBe(1000);
    expect(handback?.[1]?.nextCheckAt).toBeNull();
  });
});
