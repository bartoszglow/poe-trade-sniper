import { describe, expect, it, vi } from 'vitest';
import type { Listing, TravelEvent } from '@poe-sniper/shared';
import { loadConfig } from '../config/env.js';
import { BuySessionLock } from '../events/buy-session-lock.service.js';
import { RealtimeBus } from '../events/realtime-bus.js';
import type { RateLimitGovernor } from '../ratelimit/rate-limit-governor.js';
import type { SearchManager } from '../search/search-manager.js';
import {
  TradeApiError,
  type TradeApiClient,
  type TradeSearchRef,
} from '../trade-api/trade-api.client.js';
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

function createService(
  options: {
    autoTravel?: boolean;
    travelDelayMs?: number;
    /** Budget the governor reports for the auto-failure re-resolve gate (default 0
     *  → refine always skips, so it never interferes with the base-behaviour tests). */
    headroom?: number;
    /** What refreshListing returns when a refine does run (null = offer gone). */
    refreshListingResult?: Listing | null;
  } = {},
) {
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

  const refreshListing = vi.fn(() => Promise.resolve(options.refreshListingResult ?? null));
  const searchManager = {
    isAutoTravelEnabled: vi.fn(() => options.autoTravel ?? false),
    getSearchRef: vi.fn(() => SEARCH),
    refreshListing,
  } as unknown as SearchManager;

  const governor = {
    minHeadroom: vi.fn(() => options.headroom ?? 0),
  } as unknown as RateLimitGovernor;

  const gameFocus = { focus: vi.fn() };
  const buyLock = new BuySessionLock();
  const service = new TravelService(
    config,
    tradeApi,
    searchManager,
    realtimeBus,
    gameFocus as unknown as GameFocusService,
    buyLock,
    governor,
  );
  service.onApplicationBootstrap();
  return {
    service,
    tradeApi,
    realtimeBus,
    travelEvents,
    travelCalls,
    gameFocus,
    buyLock,
    refreshListing,
    governor,
  };
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
    // A plain (non-TradeApiError) rejection can't be classified → generic reason.
    expect(failed?.reason).toBe('unknown');
    service.onApplicationShutdown();
  });

  it('classifies a GGG "item no longer available" (404 code 1) as reason=item_gone', async () => {
    const { service, tradeApi, travelEvents } = createService();
    (tradeApi.travel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new TradeApiError(404, 'travel: HTTP 404: Item no longer available (code 1)', 1),
    );
    service.enqueue(manualRequest());
    await flushQueue();

    const failed = travelEvents.find((event) => event.phase === 'failed');
    expect(failed?.reason).toBe('item_gone');
    expect(service.status().lastTravel?.reason).toBe('item_gone');
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

  it('auto-travels a deal alert with identical gating; deal-updated never triggers (plan 41)', async () => {
    const dealInfo = {
      baselineExalted: 1000,
      discountPercent: 32,
      discountExalted: 320,
      baselineStale: false,
      divinePriceExalted: null,
    };
    const dealOptedIn = createService({ autoTravel: true });
    dealOptedIn.realtimeBus.publish({
      type: 'deal',
      listing: listingWithToken('jwt-deal'),
      deal: dealInfo,
    });
    await flushQueue();
    expect(dealOptedIn.tradeApi.travel).toHaveBeenCalledTimes(1);
    expect(dealOptedIn.travelEvents[0]?.source).toBe('auto');
    dealOptedIn.service.onApplicationShutdown();

    const dealOptedOut = createService({ autoTravel: false });
    dealOptedOut.realtimeBus.publish({
      type: 'deal',
      listing: listingWithToken('jwt-deal'),
      deal: dealInfo,
    });
    await flushQueue();
    expect(dealOptedOut.tradeApi.travel).not.toHaveBeenCalled();
    dealOptedOut.service.onApplicationShutdown();

    const reServe = createService({ autoTravel: true });
    reServe.realtimeBus.publish({
      type: 'deal-updated',
      listing: listingWithToken('jwt-deal'),
      deal: dealInfo,
    });
    await flushQueue();
    expect(reServe.tradeApi.travel).not.toHaveBeenCalled();
    reServe.service.onApplicationShutdown();
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

  describe('auto-failure auto-retry (option B)', () => {
    function lastFailed(events: TravelEvent[]): TravelEvent | undefined {
      return events.filter((event) => event.phase === 'failed').at(-1);
    }

    it('reports item_gone (and does not re-travel) when the offer is gone', async () => {
      const { service, tradeApi, realtimeBus, travelEvents, refreshListing } = createService({
        autoTravel: true,
        headroom: 1,
        refreshListingResult: null, // both re-resolve tiers miss → gone
      });
      (tradeApi.travel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
      realtimeBus.publish({ type: 'hit', listing: listingWithToken('jwt-auto') });
      await flushQueue();

      expect(refreshListing).toHaveBeenCalledTimes(1);
      expect(tradeApi.travel).toHaveBeenCalledTimes(1); // gone → no second travel
      expect(lastFailed(travelEvents)?.reason).toBe('item_gone');
      service.onApplicationShutdown();
    });

    it('re-travels with a fresh token when the offer is still listed', async () => {
      const { service, tradeApi, realtimeBus, refreshListing } = createService({
        autoTravel: true,
        headroom: 1,
        refreshListingResult: listingWithToken('fresh-token'), // recovered → re-travel
      });
      (tradeApi.travel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
      realtimeBus.publish({ type: 'hit', listing: listingWithToken('jwt-auto') });
      await flushQueue();

      // One re-resolve, then a SECOND travel with the recovered token — exactly
      // what the operator's manual Retry does.
      expect(refreshListing).toHaveBeenCalledTimes(1);
      expect(tradeApi.travel).toHaveBeenCalledTimes(2);
      expect((tradeApi.travel as ReturnType<typeof vi.fn>).mock.calls[1]?.[0]).toBe('fresh-token');
      service.onApplicationShutdown();
    });

    it('skips the re-resolve when budget headroom is below the reserve', async () => {
      const { service, tradeApi, realtimeBus, refreshListing } = createService({
        autoTravel: true,
        headroom: 0.2, // < TRAVEL_REFINE_MIN_HEADROOM (0.3)
        refreshListingResult: null,
      });
      (tradeApi.travel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
      realtimeBus.publish({ type: 'hit', listing: listingWithToken('jwt-auto') });
      await flushQueue();

      expect(refreshListing).not.toHaveBeenCalled();
      service.onApplicationShutdown();
    });

    it('does not re-resolve a manual failure (Retry does that explicitly)', async () => {
      const { service, tradeApi, refreshListing } = createService({ headroom: 1 });
      (tradeApi.travel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
      service.enqueue(manualRequest());
      await flushQueue();

      expect(refreshListing).not.toHaveBeenCalled();
      service.onApplicationShutdown();
    });

    it('retries a transient server error (code 4) — it is not definitive', async () => {
      const { service, tradeApi, realtimeBus, refreshListing } = createService({
        autoTravel: true,
        headroom: 1,
        refreshListingResult: listingWithToken('fresh-token'),
      });
      (tradeApi.travel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new TradeApiError(500, 'travel: internal error', 4),
      );
      realtimeBus.publish({ type: 'hit', listing: listingWithToken('jwt-auto') });
      await flushQueue();

      expect(refreshListing).toHaveBeenCalledTimes(1);
      expect(tradeApi.travel).toHaveBeenCalledTimes(2);
      service.onApplicationShutdown();
    });

    it('does not retry a rate-limit failure (code 3)', async () => {
      const { service, tradeApi, realtimeBus, travelEvents, refreshListing } = createService({
        autoTravel: true,
        headroom: 1,
        refreshListingResult: listingWithToken('fresh-token'),
      });
      (tradeApi.travel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new TradeApiError(400, 'travel: rate limit exceeded', 3),
      );
      realtimeBus.publish({ type: 'hit', listing: listingWithToken('jwt-auto') });
      await flushQueue();

      expect(refreshListing).not.toHaveBeenCalled();
      expect(lastFailed(travelEvents)?.reason).toBe('rate_limited');
      service.onApplicationShutdown();
    });

    it('does not retry a not-in-game failure (400 code 2) — labels + leaves manual Retry', async () => {
      const { service, tradeApi, realtimeBus, travelEvents, refreshListing } = createService({
        autoTravel: true,
        headroom: 1,
        refreshListingResult: listingWithToken('fresh-token'),
      });
      (tradeApi.travel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new TradeApiError(400, 'travel: account must be in-game', 2),
      );
      realtimeBus.publish({ type: 'hit', listing: listingWithToken('jwt-auto') });
      await flushQueue();

      // Retrying can't help until the operator is in-game — so no re-resolve, no
      // second travel; just the labelled failure (the UI keeps its Retry button).
      expect(refreshListing).not.toHaveBeenCalled();
      expect(tradeApi.travel).toHaveBeenCalledTimes(1);
      expect(lastFailed(travelEvents)?.reason).toBe('not_in_game');
      service.onApplicationShutdown();
    });

    it('distinguishes on-a-map (code 2, town/hideout message) — not_in_town, no retry', async () => {
      const { service, tradeApi, realtimeBus, travelEvents, refreshListing } = createService({
        autoTravel: true,
        headroom: 1,
        refreshListingResult: listingWithToken('fresh-token'),
      });
      (tradeApi.travel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new TradeApiError(400, 'travel: You must be in a town or Hideout area to secure items', 2),
      );
      realtimeBus.publish({ type: 'hit', listing: listingWithToken('jwt-auto') });
      await flushQueue();

      // Same code 2 as not-in-game, but the message pins it to on-a-map: distinct
      // label, still not retryable (must return to town/hideout first).
      expect(refreshListing).not.toHaveBeenCalled();
      expect(lastFailed(travelEvents)?.reason).toBe('not_in_town');
      service.onApplicationShutdown();
    });

    it('distinguishes an own-listing failure (code 2, selling-yourself message)', async () => {
      const { service, tradeApi, realtimeBus, travelEvents, refreshListing } = createService({
        autoTravel: true,
        headroom: 1,
        refreshListingResult: listingWithToken('fresh-token'),
      });
      (tradeApi.travel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new TradeApiError(400, 'travel: You cannot secure items that you are selling yourself', 2),
      );
      realtimeBus.publish({ type: 'hit', listing: listingWithToken('jwt-auto') });
      await flushQueue();

      expect(refreshListing).not.toHaveBeenCalled();
      expect(lastFailed(travelEvents)?.reason).toBe('own_listing');
      service.onApplicationShutdown();
    });

    it('does not re-resolve a already-definitive failure (404 code 1)', async () => {
      const { service, tradeApi, realtimeBus, travelEvents, refreshListing } = createService({
        autoTravel: true,
        headroom: 1,
        refreshListingResult: null,
      });
      (tradeApi.travel as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new TradeApiError(404, 'travel: gone', 1),
      );
      realtimeBus.publish({ type: 'hit', listing: listingWithToken('jwt-auto') });
      await flushQueue();

      // GGG already told us it's gone — no need to spend a SEARCH-bucket re-resolve.
      expect(refreshListing).not.toHaveBeenCalled();
      expect(lastFailed(travelEvents)?.reason).toBe('item_gone');
      service.onApplicationShutdown();
    });
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
      new BuySessionLock(),
      { minHeadroom: () => 0 } as unknown as RateLimitGovernor,
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
      new BuySessionLock(),
      { minHeadroom: () => 0 } as unknown as RateLimitGovernor,
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
