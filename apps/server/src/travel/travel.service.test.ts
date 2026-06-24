import { describe, expect, it, vi } from 'vitest';
import type { Listing, TravelEvent } from '@poe-sniper/shared';
import { loadConfig } from '../config/env.js';
import { RealtimeBus } from '../events/realtime-bus.js';
import type { SearchManager } from '../search/search-manager.js';
import type { TradeApiClient, TradeSearchRef } from '../trade-api/trade-api.client.js';
import { TravelService, type TravelRequest } from './travel.service.js';
import type { GameFocusService } from './game-focus.service.js';

const SEARCH: TradeSearchRef = { realm: 'poe2', league: 'Standard', searchId: 's1' };

function listingWithToken(token: string | null): Listing {
  return {
    listingId: 'listing1',
    searchId: 's1',
    itemName: 'Storm Veil',
    price: null,
    seller: null,
    hideoutToken: token,
    item: null,
    detectedAt: '2026-06-12T10:00:00.000Z',
  };
}

function manualRequest(overrides: Partial<TravelRequest> = {}): TravelRequest {
  return {
    hideoutToken: 'jwt-token',
    search: SEARCH,
    listingId: 'listing1',
    itemName: 'Storm Veil',
    source: 'manual',
    ...overrides,
  };
}

function createService(options: { autoTravel?: boolean; travelDelayMs?: number } = {}) {
  const config = loadConfig({});
  const realtimeBus = new RealtimeBus();
  const travelEvents: TravelEvent[] = [];
  realtimeBus.subscribe((event) => {
    if (event.type === 'travel') travelEvents.push(event);
  });

  const travelCalls: string[] = [];
  const tradeApi = {
    travel: vi.fn(async (token: string) => {
      travelCalls.push(`start:${token}`);
      if (options.travelDelayMs) {
        await new Promise((resolveSleep) => setTimeout(resolveSleep, options.travelDelayMs));
      }
      travelCalls.push(`end:${token}`);
    }),
  } as unknown as TradeApiClient;

  const searchManager = {
    isAutoTravelEnabled: vi.fn(() => options.autoTravel ?? false),
    getSearchRef: vi.fn(() => SEARCH),
  } as unknown as SearchManager;

  const gameFocus = { focus: vi.fn() };
  const service = new TravelService(
    config,
    tradeApi,
    searchManager,
    realtimeBus,
    gameFocus as unknown as GameFocusService,
  );
  service.onApplicationBootstrap();
  return { service, tradeApi, realtimeBus, travelEvents, travelCalls, gameFocus };
}

async function flushQueue(): Promise<void> {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, 30));
}

describe('TravelService', () => {
  it('processes travels strictly one at a time, in order', async () => {
    const { service, travelCalls } = createService({ travelDelayMs: 10 });
    service.enqueue(manualRequest({ hideoutToken: 'first' }));
    service.enqueue(manualRequest({ hideoutToken: 'second' }));
    await flushQueue();

    expect(travelCalls).toEqual(['start:first', 'end:first', 'start:second', 'end:second']);
    service.onApplicationShutdown();
  });

  it('publishes queued → started → success and tracks lastTravel', async () => {
    const { service, travelEvents } = createService();
    service.enqueue(manualRequest());
    await flushQueue();

    expect(travelEvents.map((event) => event.phase)).toEqual(['queued', 'started', 'success']);
    expect(service.status().lastTravel?.phase).toBe('success');
    expect(service.status().queueLength).toBe(0);
    service.onApplicationShutdown();
  });

  it('publishes failed with the trade-api error detail', async () => {
    const { service, tradeApi, travelEvents } = createService();
    (tradeApi.travel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('travel: HTTP 403: Forbidden (code 6)'),
    );
    service.enqueue(manualRequest());
    await flushQueue();

    const failed = travelEvents.find((event) => event.phase === 'failed');
    expect(failed?.detail).toContain('code 6');
    service.onApplicationShutdown();
  });

  it('auto-travels a hit only when the search opted in and a token exists', async () => {
    const optedIn = createService({ autoTravel: true });
    optedIn.realtimeBus.publish({ type: 'hit', listing: listingWithToken('jwt-x') });
    await flushQueue();
    expect(optedIn.tradeApi.travel).toHaveBeenCalledTimes(1);
    expect(optedIn.travelEvents[0]?.source).toBe('auto');
    optedIn.service.onApplicationShutdown();

    const optedOut = createService({ autoTravel: false });
    optedOut.realtimeBus.publish({ type: 'hit', listing: listingWithToken('jwt-x') });
    await flushQueue();
    expect(optedOut.tradeApi.travel).not.toHaveBeenCalled();
    optedOut.service.onApplicationShutdown();

    const tokenless = createService({ autoTravel: true });
    tokenless.realtimeBus.publish({ type: 'hit', listing: listingWithToken(null) });
    await flushQueue();
    expect(tokenless.tradeApi.travel).not.toHaveBeenCalled();
    tokenless.service.onApplicationShutdown();
  });

  it('focuses the game as travel starts — auto AND manual (snaps to the game on press)', async () => {
    const auto = createService({ autoTravel: true });
    auto.realtimeBus.publish({ type: 'hit', listing: listingWithToken('jwt-x') });
    await flushQueue();
    expect(auto.gameFocus.focus).toHaveBeenCalledTimes(1);
    auto.service.onApplicationShutdown();

    const manual = createService({ autoTravel: false });
    manual.service.enqueue(manualRequest());
    await flushQueue();
    expect(manual.gameFocus.focus).toHaveBeenCalledTimes(1);
    manual.service.onApplicationShutdown();
  });

  it('never auto-travels twice to the same listing (re-detection after returning)', async () => {
    const { service, tradeApi, realtimeBus } = createService({ autoTravel: true });
    realtimeBus.publish({ type: 'hit', listing: listingWithToken('jwt-first') });
    await flushQueue();
    // The buyer returned to hideout without purchasing — the trade site
    // re-emits the same listing as a brand-new hit (fresh token).
    realtimeBus.publish({ type: 'hit', listing: listingWithToken('jwt-second') });
    await flushQueue();

    expect(tradeApi.travel).toHaveBeenCalledTimes(1);
    service.onApplicationShutdown();
  });

  it('still auto-travels on re-detection when the first attempt failed', async () => {
    const { service, tradeApi, realtimeBus } = createService({ autoTravel: true });
    (tradeApi.travel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('travel: HTTP 403'),
    );
    realtimeBus.publish({ type: 'hit', listing: listingWithToken('jwt-first') });
    await flushQueue();
    realtimeBus.publish({ type: 'hit', listing: listingWithToken('jwt-second') });
    await flushQueue();

    expect(tradeApi.travel).toHaveBeenCalledTimes(2);
    service.onApplicationShutdown();
  });

  it('manual travel is allowed to a listing already auto-traveled', async () => {
    const { service, tradeApi, realtimeBus } = createService({ autoTravel: true });
    realtimeBus.publish({ type: 'hit', listing: listingWithToken('jwt-auto') });
    await flushQueue();
    service.enqueue(manualRequest({ hideoutToken: 'jwt-manual' }));
    await flushQueue();

    expect(tradeApi.travel).toHaveBeenCalledTimes(2);
    service.onApplicationShutdown();
  });

  it('evicts the oldest remembered listings beyond TRAVEL_DEDUPE_MAX_ENTRIES', async () => {
    const config = loadConfig({ TRAVEL_DEDUPE_MAX_ENTRIES: '10' });
    const realtimeBus = new RealtimeBus();
    const travel = vi.fn().mockResolvedValue(undefined);
    const tradeApi = { travel } as unknown as TradeApiClient;
    const service = new TravelService(
      config,
      tradeApi,
      { isAutoTravelEnabled: () => true, getSearchRef: () => SEARCH } as unknown as SearchManager,
      realtimeBus,
      { focus: vi.fn() } as unknown as GameFocusService,
    );
    service.onApplicationBootstrap();

    // listing1 travels, then 10 other listings push it out of the window.
    realtimeBus.publish({ type: 'hit', listing: listingWithToken('jwt-1') });
    await flushQueue();
    for (let index = 0; index < 10; index += 1) {
      realtimeBus.publish({
        type: 'hit',
        listing: { ...listingWithToken('jwt-n'), listingId: `other${index}` },
      });
    }
    await flushQueue();
    realtimeBus.publish({ type: 'hit', listing: listingWithToken('jwt-again') });
    await flushQueue();

    // 1 (listing1) + 10 (others) + 1 (listing1 evicted, travels again)
    expect(travel).toHaveBeenCalledTimes(12);
    service.onApplicationShutdown();
  });

  it('drops stale queue entries instead of firing expired tokens', async () => {
    const config = loadConfig({ TRAVEL_TOKEN_MAX_AGE_MS: '10000' });
    const realtimeBus = new RealtimeBus();
    const travelEvents: TravelEvent[] = [];
    realtimeBus.subscribe((event) => {
      if (event.type === 'travel') travelEvents.push(event);
    });

    // First travel blocks the queue until we release it; meanwhile the clock
    // (Date only — timers stay real) jumps past the token max age, so the
    // second entry is stale by the time the queue reaches it.
    let releaseFirstTravel: () => void = () => {};
    const firstTravelGate = new Promise<void>((resolveGate) => {
      releaseFirstTravel = resolveGate;
    });
    const travel = vi
      .fn()
      .mockImplementationOnce(() => firstTravelGate)
      .mockResolvedValue(undefined);
    const tradeApi = { travel } as unknown as TradeApiClient;
    const service = new TravelService(
      config,
      tradeApi,
      { isAutoTravelEnabled: () => false, getSearchRef: () => SEARCH } as unknown as SearchManager,
      realtimeBus,
      { focus: vi.fn() } as unknown as GameFocusService,
    );

    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-06-12T10:00:00.000Z'));
      service.enqueue(manualRequest({ hideoutToken: 'first' }));
      service.enqueue(manualRequest({ hideoutToken: 'second' }));
      vi.setSystemTime(new Date('2026-06-12T10:01:00.000Z'));
      releaseFirstTravel();
      await flushQueue();
    } finally {
      vi.useRealTimers();
    }

    expect(travel).toHaveBeenCalledTimes(1);
    const failed = travelEvents.find((event) => event.phase === 'failed');
    expect(failed?.detail).toContain('expired');
  });
});
