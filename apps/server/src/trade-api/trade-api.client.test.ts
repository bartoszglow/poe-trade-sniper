import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config/env.js';
import { openDatabase } from '../db/migrate.js';
import { RateLimitGovernor } from '../ratelimit/rate-limit-governor.js';
import { DbSessionStore } from '../session/db-session-store.js';
import { SessionService } from '../session/session.service.js';
import { applyPurchaseMode } from './purchase-mode.js';
import {
  NoSessionError,
  TradeApiClient,
  type FetchFunction,
  type TradeSearchRef,
} from './trade-api.client.js';

const SEARCH: TradeSearchRef = { realm: 'poe2', league: 'Standard', searchId: 'abc123' };

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function createClient(fetchStub: FetchFunction, withSession = true) {
  const database = openDatabase(':memory:');
  const sessionService = new SessionService(new DbSessionStore(database));
  if (withSession) {
    sessionService.setFromCookies({ POESESSID: 'secret' }, 'TestAgent/1.0');
  }
  const config = loadConfig({ FETCH_SPACING_MS: '100' });
  const client = new TradeApiClient(config, sessionService, new RateLimitGovernor(), fetchStub);
  return { client, sessionService, database };
}

describe('TradeApiClient', () => {
  it('throws NoSessionError without a session — no request is fired', async () => {
    const fetchStub = vi.fn();
    const { client, database } = createClient(fetchStub, false);
    try {
      await expect(client.resolveQuery(SEARCH, 'cid')).rejects.toBeInstanceOf(NoSessionError);
      expect(fetchStub).not.toHaveBeenCalled();
    } finally {
      database.$client.close();
    }
  });

  it('resolves a query and sends the session header discipline', async () => {
    const fetchStub = vi.fn(() => Promise.resolve(jsonResponse({ id: 'abc123', query: { x: 1 } })));
    const { client, database } = createClient(fetchStub);
    try {
      const query = await client.resolveQuery(SEARCH, 'cid');
      expect(query).toEqual({ x: 1 });

      const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('https://www.pathofexile.com/api/trade2/search/poe2/Standard/abc123');
      const headers = init.headers as Record<string, string>;
      expect(headers['Cookie']).toBe('POESESSID=secret');
      expect(headers['User-Agent']).toBe('TestAgent/1.0');
      expect(headers['Origin']).toBe('https://www.pathofexile.com');
      expect(init.signal).toBeInstanceOf(AbortSignal);
    } finally {
      database.$client.close();
    }
  });

  it('rejects a resolve response without a query', async () => {
    const fetchStub = vi.fn(() => Promise.resolve(jsonResponse({ id: 'abc123' })));
    const { client, database } = createClient(fetchStub);
    try {
      await expect(client.resolveQuery(SEARCH, 'cid')).rejects.toThrowError(/no query/);
    } finally {
      database.$client.close();
    }
  });

  it('executes a search newest-first and parses ids', async () => {
    const fetchStub = vi.fn(() => Promise.resolve(jsonResponse({ result: ['a', 'b'], total: 41 })));
    const { client, database } = createClient(fetchStub);
    try {
      const execution = await client.executeSearch(SEARCH, { q: 1 }, 'cid');
      expect(execution).toEqual({ ids: ['a', 'b'], total: 41, rateLimited: false });

      const [, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toEqual({
        query: { q: 1 },
        sort: { indexed: 'desc' },
      });
    } finally {
      database.$client.close();
    }
  });

  it('flags a 429 instead of throwing (governor handles the pause)', async () => {
    const fetchStub = vi.fn(() => Promise.resolve(jsonResponse({}, 429, { 'Retry-After': '0' })));
    const { client, database } = createClient(fetchStub);
    try {
      const execution = await client.executeSearch(SEARCH, {}, 'cid');
      expect(execution.rateLimited).toBe(true);
    } finally {
      database.$client.close();
    }
  });

  it('fetches listings in batches and normalizes them', async () => {
    const fetchStub = vi.fn((url: string) => {
      const idCount = new URL(url).pathname.split('/').pop()!.split(',').length;
      const result = Array.from({ length: idCount }, (_value, index) => ({
        id: `listing-${index}`,
        item: { typeLine: 'Chaos Orb' },
        listing: { account: { name: 'seller' } },
      }));
      return Promise.resolve(jsonResponse({ result }));
    });
    const { client, database } = createClient(fetchStub as unknown as FetchFunction);
    try {
      const listingIds = Array.from({ length: 25 }, (_value, index) => `id${index}`);
      const listings = await client.fetchListings(SEARCH, listingIds, 'cid');
      expect(fetchStub).toHaveBeenCalledTimes(3); // 10 + 10 + 5
      expect(listings).toHaveLength(25);
      expect(listings[0]?.searchId).toBe('abc123');
    } finally {
      database.$client.close();
    }
  });

  it('probeMyAccount: 200 = logged in, redirect = guest; result lands in session status', async () => {
    const loggedIn = vi.fn(() => Promise.resolve(new Response('', { status: 200 })));
    const first = createClient(loggedIn);
    try {
      await expect(first.client.probeMyAccount('cid')).resolves.toBe(true);
      expect(first.sessionService.publicStatus().probedValid).toBe(true);
    } finally {
      first.database.$client.close();
    }

    const guest = vi.fn(() => Promise.resolve(new Response('', { status: 302 })));
    const second = createClient(guest);
    try {
      await expect(second.client.probeMyAccount('cid')).resolves.toBe(false);
      expect(second.sessionService.publicStatus().probedValid).toBe(false);
    } finally {
      second.database.$client.close();
    }
  });
});

describe('applyPurchaseMode', () => {
  it('overrides status for the verified instant mapping', () => {
    const application = applyPurchaseMode({ status: { option: 'any' }, q: 1 }, 'instant');
    expect(application.applied).toBe(true);
    expect(application.query).toEqual({ status: { option: 'securable' }, q: 1 });
  });

  it('keeps the resolved query for unverified mappings and reports it', () => {
    const query = { status: { option: 'whatever' } };
    const application = applyPurchaseMode(query, 'any');
    expect(application.applied).toBe(false);
    expect(application.query).toBe(query);
  });

  it('null mode is a pure passthrough', () => {
    const query = { q: 1 };
    expect(applyPurchaseMode(query, null)).toEqual({ query, applied: true });
  });
});
