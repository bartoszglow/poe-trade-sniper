import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config/env.js';
import type { RateLimitGovernor } from '../ratelimit/rate-limit-governor.js';
import type { TradeApiClient } from '../trade-api/trade-api.client.js';
import type { Poe2ScoutClient } from './poe2scout.client.js';
import type { TradeDataService } from './trade-data.service.js';
import { PriceCheckService } from './price-check.service.js';

const RARE_TEXT = [
  'Item Class: Body Armours',
  'Rarity: Rare',
  'Corpse Shell',
  'Advanced Dualstring Armour',
  '--------',
  'Item Level: 81',
  '--------',
  '+25 to maximum Life',
].join('\n');

const CURRENCY_TEXT = [
  'Item Class: Stackable Currency',
  'Rarity: Currency',
  'Divine Orb',
  '--------',
  'Stack Size: 3/10',
].join('\n');

function makeService(options: {
  headroom: number;
  priceSearch?: TradeApiClient['priceSearch'];
  poe2scoutPrice?: number | null;
}) {
  const config = loadConfig({});
  const tradeData = {
    getCompiledStats: vi.fn(() =>
      Promise.resolve([
        {
          id: 'explicit.stat_life',
          type: 'explicit',
          text: '+# to maximum Life',
          regex: /^\+([+-]?\d+(?:\.\d+)?) to maximum Life$/,
          specificity: 19,
        },
      ]),
    ),
    isKnownItemName: vi.fn(() => Promise.resolve(true)),
  } as unknown as TradeDataService;
  const poe2scout = {
    priceByName: vi.fn(() =>
      Promise.resolve(
        options.poe2scoutPrice == null
          ? null
          : { amount: options.poe2scoutPrice, currency: 'exalted' },
      ),
    ),
  } as unknown as Poe2ScoutClient;
  const priceSearch = vi.fn(
    options.priceSearch ?? (() => Promise.resolve({ listings: [], total: 0, rateLimited: false })),
  );
  const tradeApi = { priceSearch } as unknown as TradeApiClient;
  const governor = { headroom: () => options.headroom } as unknown as RateLimitGovernor;
  const service = new PriceCheckService(config, tradeData, poe2scout, tradeApi, governor);
  return { service, priceSearch, poe2scout };
}

describe('PriceCheckService', () => {
  it('prices a rare via trade2 listings when budget is healthy', async () => {
    const { service, priceSearch } = makeService({
      headroom: 0.8,
      priceSearch: () =>
        Promise.resolve({
          listings: [{ price: { amount: 5, currency: 'divine' }, seller: 'a', indexedAt: null }],
          total: 1,
          rateLimited: false,
        }),
    });
    const result = await service.check(RARE_TEXT);
    expect(priceSearch).toHaveBeenCalledOnce();
    // The body MUST carry the { query, sort } envelope GGG requires — a flat
    // body 400s (regression guard for the review S2 finding).
    const passedQuery = priceSearch.mock.calls[0]![2] as { query: unknown; sort: unknown };
    expect(passedQuery).toHaveProperty('query');
    expect(passedQuery).toHaveProperty('sort');
    expect((passedQuery.query as { status: unknown }).status).toBeDefined();
    expect(result.kind).toBe('listings');
    expect(result.listings[0]?.price).toEqual({ amount: 5, currency: 'divine' });
    expect(result.item.matchedStats.map((stat) => stat.statId)).toEqual(['explicit.stat_life']);
  });

  it('DECLINES the trade2 query below the reserve headroom (D-pc-2), never calling GGG', async () => {
    const { service, priceSearch } = makeService({ headroom: 0.1 }); // < default 0.3
    const result = await service.check(RARE_TEXT);
    expect(priceSearch).not.toHaveBeenCalled();
    expect(result.kind).toBe('unavailable');
    expect(result.declineReason).toBe('budget-low');
  });

  it('prices a fixed-value currency via poe2scout, no GGG traffic', async () => {
    const { service, priceSearch, poe2scout } = makeService({ headroom: 0.05, poe2scoutPrice: 12 });
    const result = await service.check(CURRENCY_TEXT);
    expect(poe2scout.priceByName).toHaveBeenCalledWith('Divine Orb');
    expect(priceSearch).not.toHaveBeenCalled(); // aggregator path, budget irrelevant
    expect(result.kind).toBe('aggregate');
    expect(result.estimate).toEqual({ amount: 12, currency: 'exalted' });
  });

  it('a rate-limited trade2 response degrades to unavailable/budget-low', async () => {
    const { service } = makeService({
      headroom: 0.9,
      priceSearch: () => Promise.resolve({ listings: [], total: 0, rateLimited: true }),
    });
    const result = await service.check(RARE_TEXT);
    expect(result.kind).toBe('unavailable');
    expect(result.declineReason).toBe('budget-low');
  });

  it('empty/garbage text yields unavailable with no query', async () => {
    const { service, priceSearch } = makeService({ headroom: 1 });
    const result = await service.check('\n\n');
    expect(priceSearch).not.toHaveBeenCalled();
    expect(result.kind).toBe('unavailable');
  });
});
