import { describe, expect, it, vi } from 'vitest';
import type { Listing } from '@poe-sniper/shared';
import type { EngineCallbacks, EngineContext } from './detection-engine.js';
import {
  parseLiveMessage,
  reconnectDelayForClose,
  reconnectDelayFromLadder,
} from './live-message.js';
import { PollEngine, type PollTradeApi } from './poll-engine.js';

const CONTEXT: EngineContext = {
  search: { realm: 'poe2', league: 'Standard', searchId: 's1' },
  query: { q: 1 },
  correlationId: 'cid',
};

const CONFIG = { MAX_FRESH_IDS_PER_TICK: 3, SEEN_IDS_CAP: 5 };

function listingFor(listingId: string): Listing {
  return {
    listingId,
    searchId: 's1',
    itemName: 'Item',
    price: null,
    seller: null,
    hideoutToken: null,
    item: null,
    detectedAt: '2026-06-12T10:00:00.000Z',
  };
}

function createEngine(idsPerTick: string[][]) {
  let tickIndex = -1;
  const tradeApi: PollTradeApi = {
    executeSearch: vi.fn(() => {
      tickIndex += 1;
      return Promise.resolve({
        ids: idsPerTick[Math.min(tickIndex, idsPerTick.length - 1)] ?? [],
        total: 0,
        rateLimited: false,
      });
    }),
    fetchListings: vi.fn((_search, ids: string[]) =>
      Promise.resolve(ids.map((listingId) => listingFor(listingId))),
    ),
  };
  const onListings = vi.fn();
  const onStatus = vi.fn();
  const callbacks: EngineCallbacks = { onListings, onStatus, onDemote: vi.fn() };
  const engine = new PollEngine(CONFIG, tradeApi);
  engine.start(CONTEXT, callbacks);
  return { engine, tradeApi, onListings, onStatus };
}

describe('PollEngine', () => {
  it('marks the first round as baseline without fetching', async () => {
    const { engine, tradeApi, onListings } = createEngine([['a', 'b']]);
    await engine.tick();
    expect(onListings).not.toHaveBeenCalled();
    expect(tradeApi.fetchListings).not.toHaveBeenCalled();
  });

  it('emits only ids unseen since the previous rounds', async () => {
    const { engine, onListings } = createEngine([
      ['a', 'b'],
      ['c', 'a', 'b'],
    ]);
    await engine.tick();
    await engine.tick();
    expect(onListings).toHaveBeenCalledTimes(1);
    const emitted = onListings.mock.calls[0]?.[0] as Listing[];
    expect(emitted.map((listing) => listing.listingId)).toEqual(['c']);
  });

  it('caps a broad-search burst at MAX_FRESH_IDS_PER_TICK', async () => {
    const { engine, onListings } = createEngine([[], ['n1', 'n2', 'n3', 'n4', 'n5']]);
    await engine.tick();
    await engine.tick();
    const emitted = onListings.mock.calls[0]?.[0] as Listing[];
    expect(emitted).toHaveLength(3);
  });

  it('reports degraded and skips the round on a 429', async () => {
    const tradeApi: PollTradeApi = {
      executeSearch: vi.fn(() => Promise.resolve({ ids: [], total: 0, rateLimited: true })),
      fetchListings: vi.fn(),
    };
    const onStatus = vi.fn();
    const engine = new PollEngine(CONFIG, tradeApi);
    engine.start(CONTEXT, { onListings: vi.fn(), onStatus, onDemote: vi.fn() });
    await engine.tick();
    expect(onStatus).toHaveBeenCalledWith('degraded', expect.stringContaining('rate-limited'));
    expect(tradeApi.fetchListings).not.toHaveBeenCalled();
  });

  it('does nothing after stop()', async () => {
    const { engine, tradeApi } = createEngine([['a']]);
    engine.stop();
    await engine.tick();
    expect(tradeApi.executeSearch).not.toHaveBeenCalled();
  });
});

describe('parseLiveMessage', () => {
  it('extracts ids from the {new: [...]} frame', () => {
    expect(parseLiveMessage('{"new":["a","b"]}')).toEqual(['a', 'b']);
  });

  it('ignores keepalives, junk and empty frames', () => {
    expect(parseLiveMessage('ping')).toBeNull();
    expect(parseLiveMessage('{"auth":true}')).toBeNull();
    expect(parseLiveMessage('{"new":[]}')).toBeNull();
  });
});

describe('reconnectDelayForClose', () => {
  const ladder = [1_000, 5_000, 20_000, 60_000];

  it('1013 (Try Again Later) jumps straight to the top rung', () => {
    expect(reconnectDelayForClose(1013, ladder, 0)).toBe(60_000);
  });

  it('other codes follow the ladder', () => {
    expect(reconnectDelayForClose(1006, ladder, 0)).toBe(1_000);
    expect(reconnectDelayForClose(1006, ladder, 2)).toBe(20_000);
  });
});

describe('reconnectDelayFromLadder', () => {
  const ladder = [1_000, 5_000, 20_000, 60_000];

  it('climbs the ladder per consecutive failure', () => {
    expect(reconnectDelayFromLadder(ladder, 0)).toBe(1_000);
    expect(reconnectDelayFromLadder(ladder, 1)).toBe(5_000);
    expect(reconnectDelayFromLadder(ladder, 3)).toBe(60_000);
  });

  it('stays on the last rung past the ladder end', () => {
    expect(reconnectDelayFromLadder(ladder, 99)).toBe(60_000);
  });
});
