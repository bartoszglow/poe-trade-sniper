import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config/env.js';
import type { RateLimitGovernor } from '../ratelimit/rate-limit-governor.js';
import type { TradeApiClient } from '../trade-api/trade-api.client.js';
import type { Poe2ScoutClient } from '../market-data/poe2scout.client.js';
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

const MAGIC_TEXT = [
  'Item Class: Belts',
  'Rarity: Magic',
  'Sturdy Heavy Belt of the Whelpling',
  '--------',
  'Item Level: 40',
].join('\n');

function makeService(options: {
  headroom: number;
  priceSearch?: TradeApiClient['priceSearch'];
  poe2scoutPrice?: number | null;
  /** null → operator has no searches (exercises the currentLeague fallback). */
  primaryLeague?: string | null;
  currentLeague?: string | null;
  isKnownItemName?: boolean;
  baseTypeMatch?: string | null;
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
    isKnownItemName: vi.fn(() => Promise.resolve(options.isKnownItemName ?? true)),
    matchBaseType: vi.fn(() => Promise.resolve(options.baseTypeMatch ?? null)),
  } as unknown as TradeDataService;
  const poe2scout = {
    priceByName: vi.fn(() =>
      Promise.resolve(
        options.poe2scoutPrice == null
          ? null
          : { amount: options.poe2scoutPrice, currency: 'exalted' },
      ),
    ),
    currentLeague: vi.fn(() => Promise.resolve(options.currentLeague ?? null)),
  } as unknown as Poe2ScoutClient;
  const priceSearch = vi.fn(
    options.priceSearch ?? (() => Promise.resolve({ listings: [], total: 0, rateLimited: false })),
  );
  const tradeApi = { priceSearch } as unknown as TradeApiClient;
  const governor = {
    minHeadroom: () => options.headroom,
  } as unknown as RateLimitGovernor;
  const searchManager = {
    getPrimaryLeague: () =>
      options.primaryLeague === undefined ? 'Runes of Aldur' : options.primaryLeague,
  } as unknown as import('../search/search-manager.js').SearchManager;
  const tierData = {
    tierForRoll: () => null,
  } as unknown as import('./tier-data.service.js').TierDataService;
  const service = new PriceCheckService(
    config,
    tradeData,
    poe2scout,
    tradeApi,
    governor,
    searchManager,
    tierData,
  );
  return { service, priceSearch, poe2scout, tradeData };
}

describe('PriceCheckService', () => {
  it('prices a rare via trade2 listings when budget is healthy', async () => {
    const { service, priceSearch } = makeService({
      headroom: 0.8,
      priceSearch: () =>
        Promise.resolve({
          listings: [
            {
              price: { amount: 5, currency: 'divine' },
              seller: 'a',
              indexedAt: null,
              whisper: '@a Hi, I would like to buy your Corpse Shell',
            },
          ],
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
    // The buy whisper survives the mapping so the UI can offer copy-to-clipboard (#16).
    expect(result.listings[0]?.whisper).toContain('buy your');
    expect(result.item.matchedStats.map((stat) => stat.statId)).toEqual(['explicit.stat_life']);
  });

  it('DECLINES the trade2 query below the reserve headroom (D-pc-2), never calling GGG', async () => {
    const { service, priceSearch } = makeService({ headroom: 0.1 }); // < default 0.3
    const result = await service.check(RARE_TEXT);
    expect(priceSearch).not.toHaveBeenCalled();
    expect(result.kind).toBe('unavailable');
    expect(result.declineReason).toBe('budget-low');
  });

  it('prices a fixed-value currency via poe2scout in the primary league, no GGG traffic', async () => {
    const { service, priceSearch, poe2scout } = makeService({ headroom: 0.05, poe2scoutPrice: 12 });
    const result = await service.check(CURRENCY_TEXT);
    // The league comes from the operator's searches, not a hardcoded default.
    expect(poe2scout.priceByName).toHaveBeenCalledWith('Divine Orb', 'Runes of Aldur');
    expect(priceSearch).not.toHaveBeenCalled(); // aggregator path, budget irrelevant
    expect(result.kind).toBe('aggregate');
    expect(result.estimate).toEqual({ amount: 12, currency: 'exalted' });
  });

  it('a fixed-value item with no aggregator price says no-price-data (not "unreadable")', async () => {
    const { service } = makeService({ headroom: 1, poe2scoutPrice: null });
    const result = await service.check(CURRENCY_TEXT);
    expect(result.kind).toBe('unavailable');
    expect(result.declineReason).toBe('no-price-data');
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

  it('falls back to the poe2scout current league when there are no searches (#18)', async () => {
    const { service, poe2scout } = makeService({
      headroom: 0.05,
      primaryLeague: null,
      currentLeague: 'Runes of Aldur',
      poe2scoutPrice: 12,
    });
    const result = await service.check(CURRENCY_TEXT);
    expect(poe2scout.currentLeague).toHaveBeenCalled();
    expect(poe2scout.priceByName).toHaveBeenCalledWith('Divine Orb', 'Runes of Aldur');
    expect(result.kind).toBe('aggregate');
  });

  it('recovers a magic item base type from its affixed name, querying by type (#19)', async () => {
    const { service, priceSearch, tradeData } = makeService({
      headroom: 0.9,
      isKnownItemName: false,
      baseTypeMatch: 'Heavy Belt',
    });
    const result = await service.check(MAGIC_TEXT);
    expect(tradeData.matchBaseType).toHaveBeenCalledWith('Sturdy Heavy Belt of the Whelpling');
    expect(priceSearch).toHaveBeenCalledOnce();
    const passed = priceSearch.mock.calls[0]![2] as { query: { type?: string } };
    expect(passed.query.type).toBe('Heavy Belt');
    expect(result.kind).toBe('listings');
  });
});
