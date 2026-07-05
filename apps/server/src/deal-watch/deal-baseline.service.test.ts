import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config/env.js';
import type { Poe2ScoutClient } from '../market-data/poe2scout.client.js';
import type { RateLimitGovernor } from '../ratelimit/rate-limit-governor.js';
import type { RawTradeListing, TradeApiClient } from '../trade-api/trade-api.client.js';
import { DealBaselineService } from './deal-baseline.service.js';

const DEFINITION = { type: 'Barrage', status: { option: 'securable' } };

function listing(amount: number, currency: string): RawTradeListing {
  return { price: { amount, currency }, seller: 'seller#1234', indexedAt: null, whisper: null };
}

function createService(options: {
  listings?: RawTradeListing[];
  rateLimited?: boolean;
  headroom?: number;
  rates?: Map<string, number> | null;
  divinePrice?: number | null;
  configOverrides?: Record<string, string>;
}) {
  const config = loadConfig({
    DEAL_MIN_SAMPLE: '3',
    DEAL_BASELINE_K: '3',
    DEAL_OUTLIER_RATIO: '0.5',
    ...options.configOverrides,
  });
  const priceSearch = vi.fn().mockResolvedValue({
    listings: options.listings ?? [],
    total: options.listings?.length ?? 0,
    rateLimited: options.rateLimited ?? false,
  });
  const tradeApi = { priceSearch } as unknown as TradeApiClient;
  const governor = {
    minHeadroom: vi.fn().mockReturnValue(options.headroom ?? 1),
  } as unknown as RateLimitGovernor;
  const poe2scout = {
    currencyRatesByApiId: vi
      .fn()
      .mockResolvedValue(options.rates === undefined ? new Map([['divine', 700]]) : options.rates),
    divinePriceExalted: vi
      .fn()
      .mockResolvedValue(options.divinePrice === undefined ? 700 : options.divinePrice),
  } as unknown as Poe2ScoutClient;
  const service = new DealBaselineService(config, tradeApi, governor, poe2scout);
  return { service, priceSearch, governor };
}

describe('DealBaselineService.computeBaseline', () => {
  it('declines below the headroom reserve WITHOUT spending GGG budget', async () => {
    const { service, priceSearch } = createService({ headroom: 0.1 });
    const result = await service.computeBaseline(DEFINITION, 'poe2', 'League');
    expect(result.kind).toBe('budget-low');
    expect(priceSearch).not.toHaveBeenCalled();
  });

  it('propagates a GGG 429 as rate-limited', async () => {
    const { service } = createService({ rateLimited: true });
    const result = await service.computeBaseline(DEFINITION, 'poe2', 'League');
    expect(result.kind).toBe('rate-limited');
  });

  it('POSTs the baseline-shaped query: definition status kept, price asc, no price filter', async () => {
    const { service, priceSearch } = createService({
      listings: [listing(100, 'exalted'), listing(110, 'exalted'), listing(120, 'exalted')],
    });
    await service.computeBaseline(DEFINITION, 'poe2', 'League');
    const body = priceSearch.mock.calls[0]![2] as {
      query: { status: unknown; filters?: unknown };
      sort: unknown;
    };
    // The definition's own status is the operator's purchasable market —
    // forcing `online` missed offline-seller instant-buyout listings
    // (2 vs 56 on identical constraints, api-notes 2026-07-05).
    expect(body.query.status).toEqual({ option: 'securable' });
    expect(body.sort).toEqual({ price: 'asc' });
    expect(JSON.stringify(body.query)).not.toContain('price');
  });

  it('computes the median of the cheapest K usable listings, cross-currency', async () => {
    const { service } = createService({
      listings: [
        listing(700, 'exalted'),
        listing(1, 'divine'), // 700 exalted
        listing(750, 'exalted'),
        listing(800, 'exalted'),
        listing(2, 'divine'), // 1400 exalted
      ],
    });
    const result = await service.computeBaseline(DEFINITION, 'poe2', 'League');
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    // Sorted: 700, 700, 750, 800, 1400 → cheapest 3 → median 700.
    expect(result.baseline.amountExalted).toBe(700);
    expect(result.baseline.rawLowestExalted).toBe(700);
    expect(result.baseline.sampleSize).toBe(5);
    expect(result.baseline.listingsSeen).toBe(5);
  });

  it('drops price-fixer outliers below ratio × median (the 1-mirror decoy inverse)', async () => {
    const { service } = createService({
      listings: [
        listing(10, 'exalted'), // decoy: far below the median of 700
        listing(690, 'exalted'),
        listing(700, 'exalted'),
        listing(710, 'exalted'),
        listing(720, 'exalted'),
      ],
    });
    const result = await service.computeBaseline(DEFINITION, 'poe2', 'League');
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    // rawLowest shows the RAW cheapest usable — the decoy itself — so the
    // operator sees what the outlier drop removed (review F10); the baseline
    // math never uses it.
    expect(result.baseline.rawLowestExalted).toBe(10);
    expect(result.baseline.amountExalted).toBe(700);
    expect(result.baseline.sampleSize).toBe(4);
  });

  it('excludes null-price, non-positive and unknown-currency listings from the sample', async () => {
    const { service } = createService({
      listings: [
        { price: null, seller: null, indexedAt: null, whisper: null },
        listing(0, 'exalted'),
        listing(99, 'waystone-10'), // barter code absent from the rate map
        listing(700, 'exalted'),
        listing(710, 'exalted'),
      ],
    });
    const result = await service.computeBaseline(DEFINITION, 'poe2', 'League');
    expect(result.kind).toBe('insufficient');
    if (result.kind !== 'insufficient') return;
    expect(result.usableCount).toBe(2);
    expect(result.listingsSeen).toBe(5);
  });

  it('degrades to insufficient when the rate map is down and listings are non-exalted', async () => {
    const { service } = createService({
      rates: null,
      listings: [listing(1, 'divine'), listing(2, 'divine'), listing(3, 'divine')],
    });
    const result = await service.computeBaseline(DEFINITION, 'poe2', 'League');
    expect(result.kind).toBe('insufficient');
  });

  it('still baselines when the outlier drop leaves fewer than the min sample (F9/D-dw-2)', async () => {
    const { service } = createService({
      listings: [
        listing(1, 'exalted'), // decoy — dropped (below 0.5 × median 3)
        listing(2, 'exalted'),
        listing(3, 'exalted'),
        listing(1000, 'exalted'),
        listing(1010, 'exalted'),
      ],
      // The min-sample gate applies to USABLE listings (5 here) — losing
      // decoys to the outlier drop must NOT un-baseline a liquid item.
      configOverrides: { DEAL_MIN_SAMPLE: '5' },
    });
    const result = await service.computeBaseline(DEFINITION, 'poe2', 'League');
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    // Survivors {2, 3, 1000, 1010} → cheapest 3 → median 3.
    expect(result.baseline.amountExalted).toBe(3);
    expect(result.baseline.sampleSize).toBe(4);
    expect(result.baseline.rawLowestExalted).toBe(1);
  });

  it('computes an even-length median (both the sample and cheapest-K, F17h)', async () => {
    const { service } = createService({
      listings: [
        listing(600, 'exalted'),
        listing(700, 'exalted'),
        listing(800, 'exalted'),
        listing(900, 'exalted'),
      ],
      // K=2 forces an even cheapest-K median: (600 + 700) / 2.
      configOverrides: { DEAL_MIN_SAMPLE: '4', DEAL_BASELINE_K: '2' },
    });
    const result = await service.computeBaseline(DEFINITION, 'poe2', 'League');
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.baseline.amountExalted).toBe(650);
  });
});
