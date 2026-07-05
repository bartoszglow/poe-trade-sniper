import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DealBaseline } from '@poe-sniper/shared';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { convertToExalted } from '../market-data/currency-rates.js';
import { Poe2ScoutClient } from '../market-data/poe2scout.client.js';
import { RateLimitGovernor } from '../ratelimit/rate-limit-governor.js';
import { TradeApiClient } from '../trade-api/trade-api.client.js';
import { baselineQuery } from './deal-query.js';

/** Rate-limit policies a baseline spends (one search POST + one fetch). */
const BASELINE_POLICIES = ['search', 'fetch'] as const;

export type BaselineComputation =
  | {
      kind: 'ok';
      baseline: DealBaseline;
      /** ApiId → exalted rate map used for normalization (decorator snapshot). */
      ratesByApiId: Map<string, number> | null;
      divinePriceExalted: number | null;
    }
  | {
      kind: 'insufficient';
      listingsSeen: number;
      usableCount: number;
      ratesByApiId: Map<string, number> | null;
      divinePriceExalted: number | null;
    }
  /** Below the governor headroom reserve — skipped, baseline goes stale honestly. */
  | { kind: 'budget-low' }
  /** GGG 429 mid-flight — the governor already paused; retry next cycle. */
  | { kind: 'rate-limited' };

/**
 * Computes the price-fixer-resistant market baseline for a deal watch
 * (plan 41, D-dw-2): cheapest ≤10 online listings, normalized to exalted via
 * poe2scout rates, leading outliers dropped, median of the cheapest K
 * survivors. Detection always outranks this work via the headroom gate.
 */
@Injectable()
export class DealBaselineService {
  private readonly logger = new Logger(DealBaselineService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(TradeApiClient) private readonly tradeApi: TradeApiClient,
    @Inject(RateLimitGovernor) private readonly governor: RateLimitGovernor,
    @Inject(Poe2ScoutClient) private readonly poe2scout: Poe2ScoutClient,
  ) {}

  async computeBaseline(
    definition: unknown,
    realm: string,
    league: string,
    correlationId: string = randomUUID(),
  ): Promise<BaselineComputation> {
    if (this.governor.minHeadroom([...BASELINE_POLICIES]) < this.config.DEAL_MIN_HEADROOM) {
      return { kind: 'budget-low' };
    }
    const search = await this.tradeApi.priceSearch(
      realm,
      league,
      { query: baselineQuery(definition), sort: { price: 'asc' } },
      10,
      correlationId,
    );
    if (search.rateLimited) return { kind: 'rate-limited' };

    // Rates are non-GGG (poe2scout, cached 15 min) — a rate outage degrades to
    // "only exalted-priced listings are usable", never to made-up numbers.
    const ratesByApiId = await this.poe2scout.currencyRatesByApiId(league);
    const divinePriceExalted = await this.poe2scout.divinePriceExalted(league);

    const usable: number[] = [];
    for (const listing of search.listings) {
      if (listing.price === null || listing.price.amount <= 0) continue;
      const exalted = convertToExalted(listing.price.amount, listing.price.currency, ratesByApiId);
      if (exalted !== null) usable.push(exalted);
    }
    const listingsSeen = search.listings.length;
    if (usable.length < this.config.DEAL_MIN_SAMPLE) {
      return {
        kind: 'insufficient',
        listingsSeen,
        usableCount: usable.length,
        ratesByApiId,
        divinePriceExalted,
      };
    }

    usable.sort((left, right) => left - right);
    const sampleMedian = median(usable);
    // Price-fixer drop (D-dw-2): a listing far below the sample's median is a
    // decoy (live specimen: a 1-mirror "cheapest" listing, api-notes 2026-07-05).
    const survivors = usable.filter(
      (amount) => amount >= sampleMedian * this.config.DEAL_OUTLIER_RATIO,
    );
    // D-dw-2: only an EMPTY survivor set is insufficient here — the min-sample
    // gate above applies to usable listings; dropping decoys must not un-baseline
    // a liquid item (review F9).
    if (survivors.length === 0) {
      return {
        kind: 'insufficient',
        listingsSeen,
        usableCount: survivors.length,
        ratesByApiId,
        divinePriceExalted,
      };
    }
    const cheapestK = survivors.slice(0, Math.min(this.config.DEAL_BASELINE_K, survivors.length));
    const baseline: DealBaseline = {
      amountExalted: median(cheapestK),
      sampleSize: survivors.length,
      // The true raw cheapest usable listing, decoys included — display-only,
      // so the operator SEES the decoy the outlier drop removed (review F10).
      rawLowestExalted: usable[0]!,
      computedAt: new Date().toISOString(),
      listingsSeen,
    };
    this.logger.debug(
      `baseline ${baseline.amountExalted.toFixed(1)}ex from ${survivors.length}/${listingsSeen} listings (${correlationId})`,
    );
    return { kind: 'ok', baseline, ratesByApiId, divinePriceExalted };
  }
}

/** Median of a pre-sorted ascending sample. */
function median(sortedSample: readonly number[]): number {
  const middle = Math.floor(sortedSample.length / 2);
  return sortedSample.length % 2 === 1
    ? sortedSample[middle]!
    : (sortedSample[middle - 1]! + sortedSample[middle]!) / 2;
}
