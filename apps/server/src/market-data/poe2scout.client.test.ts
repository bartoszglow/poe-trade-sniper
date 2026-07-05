import { describe, expect, it, vi } from 'vitest';
import type { FetchFunction } from '../trade-api/trade-api.client.js';
import { Poe2ScoutClient } from './poe2scout.client.js';

const LEAGUE = 'Runes of Aldur';
/** The six poe2scout currency categories the client aggregates per league. */
const CATEGORY_FETCH_COUNT = 6;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/** Shapes mirror the live payloads recorded in api-notes (2026-07-03/05). */
const LEAGUES_PAYLOAD = [
  { Value: 'Standard', IsCurrent: false, BaseCurrencyApiId: 'exalted' },
  {
    Value: LEAGUE,
    IsCurrent: true,
    DivinePrice: 714.3,
    BaseCurrencyApiId: 'exalted',
  },
];

const CURRENCY_ITEMS = [
  { Text: 'Divine Orb', ApiId: 'divine', CurrentPrice: 714.3 },
  { Text: 'Chaos Orb', ApiId: 'chaos', CurrentPrice: 12.5 },
  // Malformed/unusable entries the ApiId map must skip:
  { Text: 'Zero Rate', ApiId: 'zero-rate', CurrentPrice: 0 },
  { Text: 'No Api Id', CurrentPrice: 5 },
];

function makeClient(overrides?: { failAll?: boolean }) {
  const fetchFn = vi.fn((input: Parameters<FetchFunction>[0]): Promise<Response> => {
    if (overrides?.failAll) return Promise.reject(new Error('poe2scout offline'));
    const url = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
    if (url.includes('/Currencies/ByCategory')) {
      // Only the 'currency' category carries items; the rest are empty, as live.
      const hasItems = url.includes('Category=currency');
      return Promise.resolve(jsonResponse({ Items: hasItems ? CURRENCY_ITEMS : [] }));
    }
    if (url.endsWith('/Leagues')) return Promise.resolve(jsonResponse(LEAGUES_PAYLOAD));
    return Promise.resolve(jsonResponse([]));
  });
  const client = new Poe2ScoutClient(fetchFn);
  return { client, fetchFn };
}

describe('Poe2ScoutClient market-data extensions', () => {
  it('keys exchange rates by ApiId (== GGG listing currency code), skipping unusable entries', async () => {
    const { client } = makeClient();
    const rates = await client.currencyRatesByApiId(LEAGUE);
    expect(rates?.get('divine')).toBeCloseTo(714.3, 6);
    expect(rates?.get('chaos')).toBeCloseTo(12.5, 6);
    // A zero rate would silently price listings at 0; a missing ApiId is unkeyable.
    expect(rates?.has('zero-rate')).toBe(false);
    expect(rates?.size).toBe(2);
  });

  it('one category-fetch pass fills BOTH the ApiId and the Text map (no double load)', async () => {
    const { client, fetchFn } = makeClient();
    await client.currencyRatesByApiId(LEAGUE);
    expect(fetchFn).toHaveBeenCalledTimes(CATEGORY_FETCH_COUNT);
    // The Text-keyed consumer (price-check name lookup) must ride the same cache.
    const price = await client.priceByName('Divine Orb', LEAGUE);
    expect(price).toEqual({ amount: 714.3, currency: 'exalted' });
    expect(fetchFn).toHaveBeenCalledTimes(CATEGORY_FETCH_COUNT);
  });

  it('currencyRatesByApiId degrades to null when every category fetch fails', async () => {
    const { client } = makeClient({ failAll: true });
    expect(await client.currencyRatesByApiId(LEAGUE)).toBeNull();
  });

  it('divinePriceExalted reads the league DivinePrice from GET /Leagues', async () => {
    const { client, fetchFn } = makeClient();
    expect(await client.divinePriceExalted(LEAGUE)).toBeCloseTo(714.3, 6);
    // Absent DivinePrice (Standard) and unknown leagues are honestly unknown.
    expect(await client.divinePriceExalted('Standard')).toBeNull();
    expect(await client.divinePriceExalted('No Such League')).toBeNull();
    // All three reads share one cached /Leagues fetch.
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('currentLeague still resolves the IsCurrent entry after the leagues-cache refactor', async () => {
    const { client } = makeClient();
    expect(await client.currentLeague()).toBe(LEAGUE);
  });

  it('a /Leagues outage degrades currentLeague and divinePriceExalted to null', async () => {
    const { client } = makeClient({ failAll: true });
    expect(await client.currentLeague()).toBeNull();
    expect(await client.divinePriceExalted(LEAGUE)).toBeNull();
  });
});
