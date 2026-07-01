import { describe, expect, it, vi } from 'vitest';
import type { Listing } from '@poe-sniper/shared';
import { loadConfig } from '../config/env.js';
import type { TradeSearchRef } from '../trade-api/trade-api.client.js';
import type { EngineCallbacks, EngineContext } from './detection-engine.js';
import { WsEngine } from './ws-engine.js';

const SEARCH: TradeSearchRef = { realm: 'poe2', league: 'Standard', searchId: 's1' };
const frame = (jwt: string): string => JSON.stringify({ result: jwt });

/** Reach the private frame handler without opening a real socket — start() would connect
 *  to live GGG (hard rule #8). This tests the burst-coalescing logic in isolation. */
interface WsEngineInternals {
  context: EngineContext;
  callbacks: EngineCallbacks;
  handleMessage(text: string): void;
}

describe('WsEngine burst coalescing (#perf-C1)', () => {
  it('fires the first listing immediately, then coalesces frames arriving during the fetch into ONE batch', async () => {
    const config = loadConfig({});
    const fetchCalls: string[][] = [];
    let releaseFirst: () => void = () => {};
    const firstFetchGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const fetchListings = vi.fn(async (_search: TradeSearchRef, ids: string[]) => {
      fetchCalls.push([...ids]);
      // Hold the FIRST fetch open so the next frames arrive mid-flight and must coalesce.
      if (fetchCalls.length === 1) await firstFetchGate;
      return [] as Listing[];
    });

    const engine = new WsEngine(
      config,
      { fetchListings },
      () => null,
      { allowWsConnect: () => true },
      { record: vi.fn() },
    );
    const internal = engine as unknown as WsEngineInternals;
    internal.context = { search: SEARCH, query: {}, correlationId: 'cid' };
    internal.callbacks = { onListings: vi.fn(), onStatus: vi.fn() };

    internal.handleMessage(frame('a')); // first → fetch fires immediately and blocks
    internal.handleMessage(frame('b')); // arrive while the first fetch is in-flight
    internal.handleMessage(frame('c'));
    expect(fetchCalls).toEqual([['a']]); // only the first has fired; b + c are buffered

    releaseFirst();
    await vi.waitFor(() => expect(fetchCalls).toEqual([['a'], ['b', 'c']]));
    // b + c drained in ONE fetch — not two ~600ms-apart governor-spaced calls.
  });
});
