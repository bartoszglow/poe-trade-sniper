import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManagedSearch, MarketPriceSnapshot } from '@poe-sniper/shared';
import { loadConfig } from '../config/env.js';
import type { OutboundGuard } from '../guard/outbound-guard.js';
import type { TradeDataService } from '../price-check/trade-data.service.js';
import type { SearchManager } from '../search/search-manager.js';
import type { BaselineComputation, DealBaselineService } from './deal-baseline.service.js';
import { MarketPriceService } from './market-price.service.js';

const TICK_MS = 5_000;
const INTERVAL_MS = 900_000;

function makeRow(id: string): ManagedSearch {
  return {
    id,
    realm: 'poe2',
    league: 'Standard',
    label: id,
    autoTravel: false,
    autoBuy: false,
    enabled: true,
    purchaseMode: null,
    filters: { type: 'Twister', filters: {} },
    addedAt: '2026-07-05T00:00:00Z',
    roomId: null,
    archivedAt: null,
    dealWatch: null,
  };
}

const OK_COMPUTATION: BaselineComputation = {
  kind: 'ok',
  baseline: {
    amountExalted: 500,
    sampleSize: 5,
    rawLowestExalted: 480,
    computedAt: new Date().toISOString(),
    listingsSeen: 10,
  },
  ratesByApiId: null,
  divinePriceExalted: 714,
};

function createHarness(
  options: {
    enabled?: boolean;
    candidates?: Array<{ row: ManagedSearch; snapshot: MarketPriceSnapshot | null }>;
    computation?: BaselineComputation;
    paused?: boolean;
    tripped?: boolean;
    itemCategory?: string | null;
  } = {},
) {
  const config = loadConfig({
    DEAL_QUEUE_TICK_MS: String(TICK_MS),
    MARKET_CHECK_INTERVAL_MS: String(INTERVAL_MS),
    ...(options.enabled === false ? { MARKET_CHECK_ENABLED: 'false' } : {}),
  });
  const candidatesState = {
    list: options.candidates ?? [{ row: makeRow('AbC123'), snapshot: null }],
  };
  const searchManager = {
    marketCheckCandidates: vi.fn(() => candidatesState.list),
    updateMarketSnapshot: vi.fn(),
    isDetectionGloballyPaused: vi.fn(() => options.paused ?? false),
  } as unknown as SearchManager;
  const guard = { tripped: options.tripped ?? false } as unknown as OutboundGuard;
  const baselineService = {
    computeBaseline: vi.fn(() => Promise.resolve(options.computation ?? OK_COMPUTATION)),
  } as unknown as DealBaselineService;
  const tradeData = {
    categoryForItemName: vi.fn(() => Promise.resolve(options.itemCategory ?? null)),
  } as unknown as TradeDataService;
  const service = new MarketPriceService(config, searchManager, baselineService, guard, tradeData);
  return { service, searchManager, baselineService, tradeData, candidatesState };
}

describe('MarketPriceService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Deterministic scheduling: jitter/stagger collapse to their lower bound,
    // so a bootstrap candidate is due immediately.
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('checks a due candidate and persists the snapshot with the next schedule', async () => {
    const { service, searchManager, baselineService } = createHarness();
    service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(baselineService.computeBaseline).toHaveBeenCalledTimes(1);
    const persistCalls = (searchManager.updateMarketSnapshot as ReturnType<typeof vi.fn>).mock
      .calls as Array<[string, MarketPriceSnapshot | null]>;
    expect(persistCalls[0]?.[0]).toBe('AbC123');
    expect(persistCalls[0]?.[1]?.baseline.amountExalted).toBe(500);
    expect(persistCalls[0]?.[1]?.divinePriceExalted).toBe(714);
    expect(typeof persistCalls[0]?.[1]?.nextCheckAt).toBe('string');
    service.onApplicationShutdown();
  });

  it('the killswitch disables the loop entirely', async () => {
    const { service, baselineService } = createHarness({ enabled: false });
    service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(TICK_MS * 10);
    expect(baselineService.computeBaseline).not.toHaveBeenCalled();
    service.onApplicationShutdown();
  });

  it('spends nothing while paused or guard-tripped', async () => {
    for (const options of [{ paused: true }, { tripped: true }]) {
      const { service, baselineService } = createHarness(options);
      service.onApplicationBootstrap();
      await vi.advanceTimersByTimeAsync(TICK_MS * 3);
      expect(baselineService.computeBaseline).not.toHaveBeenCalled();
      service.onApplicationShutdown();
    }
  });

  it('runs at most one check per beat — a resume burst self-paces', async () => {
    const { service, baselineService } = createHarness({
      candidates: [
        { row: makeRow('row1'), snapshot: null },
        { row: makeRow('row2'), snapshot: null },
      ],
    });
    service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(baselineService.computeBaseline).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(baselineService.computeBaseline).toHaveBeenCalledTimes(2);
    service.onApplicationShutdown();
  });

  it('an insufficient market clears the snapshot instead of inventing a price', async () => {
    const { service, searchManager } = createHarness({
      computation: {
        kind: 'insufficient',
        listingsSeen: 2,
        usableCount: 2,
        ratesByApiId: null,
        divinePriceExalted: 714,
      },
    });
    service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(searchManager.updateMarketSnapshot).toHaveBeenCalledWith('AbC123', null);
    service.onApplicationShutdown();
  });

  it('budget-low backs off without touching the persisted snapshot', async () => {
    const { service, searchManager, baselineService } = createHarness({
      computation: { kind: 'budget-low' },
    });
    service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(baselineService.computeBaseline).toHaveBeenCalledTimes(1);
    expect(searchManager.updateMarketSnapshot).not.toHaveBeenCalled();
    // Backoff = interval × 0.25 with the jitter collapsed to its LOWER bound
    // (Math.random = 0 → −15%): ~191 s. No re-check before it elapses…
    await vi.advanceTimersByTimeAsync(185_000);
    expect(baselineService.computeBaseline).toHaveBeenCalledTimes(1);
    // …and the first beat after it fires the retry.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(baselineService.computeBaseline).toHaveBeenCalledTimes(2);
    service.onApplicationShutdown();
  });

  it('stack-priced items are skipped without GGG spend (shared W3 scope)', async () => {
    const { service, baselineService, tradeData } = createHarness({
      itemCategory: 'Currency',
    });
    service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(tradeData.categoryForItemName).toHaveBeenCalled();
    expect(baselineService.computeBaseline).not.toHaveBeenCalled();
    service.onApplicationShutdown();
  });

  it('a runtime-discovered new row gets a quick, not immediate, first check', async () => {
    const { service, baselineService, candidatesState } = createHarness({ candidates: [] });
    service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(TICK_MS);
    candidatesState.list = [{ row: makeRow('fresh1'), snapshot: null }];
    // Discovery beat schedules it at +30 s (random collapsed) — not yet due.
    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(baselineService.computeBaseline).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(baselineService.computeBaseline).toHaveBeenCalledTimes(1);
    service.onApplicationShutdown();
  });

  it('a row leaving the candidate set (deal enable / delete) is pruned, not checked', async () => {
    const { service, baselineService, candidatesState } = createHarness();
    service.onApplicationBootstrap();
    candidatesState.list = [];
    await vi.advanceTimersByTimeAsync(TICK_MS * 3);
    expect(baselineService.computeBaseline).not.toHaveBeenCalled();
    service.onApplicationShutdown();
  });
});
