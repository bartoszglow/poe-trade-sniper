import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  BASELINE_SAMPLE_SIZE_MAX,
  BASELINE_SAMPLE_SIZE_MIN,
  DEFAULT_BASELINE_SAMPLE_SIZE,
  type DealBaseline,
} from '@poe-sniper/shared';
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
 * (plan 41, D-dw-2 statistic + D-dw-15 operator-tunable depth): the cheapest N
 * instant-buyout listings (N = the watch's baselineSampleSize), normalized to
 * exalted via poe2scout rates, leading outliers dropped, baseline = median of
 * the cheapest N survivors. Detection always outranks this work via the
 * headroom gate.
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
    sampleSize: number = DEFAULT_BASELINE_SAMPLE_SIZE,
  ): Promise<BaselineComputation> {
    // Persisted states are zod-validated, but the clamp keeps a hand-edited
    // import or a future caller from turning the knob into a fetch amplifier.
    const clampedSampleSize = Math.min(
      BASELINE_SAMPLE_SIZE_MAX,
      Math.max(BASELINE_SAMPLE_SIZE_MIN, Math.round(sampleSize)),
    );
    if (this.governor.minHeadroom([...BASELINE_POLICIES]) < this.config.DEAL_MIN_HEADROOM) {
      return { kind: 'budget-low' };
    }
    const search = await this.tradeApi.priceSearch(
      realm,
      league,
      { query: baselineQuery(definition), sort: { price: 'asc' } },
      clampedSampleSize,
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
    // D-dw-15: a deliberately small sample (thin market) lowers the floor too —
    // an operator asking for N=3 accepts a 3-listing market.
    const insufficiencyFloor = Math.min(this.config.DEAL_MIN_SAMPLE, clampedSampleSize);
    if (usable.length < insufficiencyFloor) {
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
    // D-dw-15: the base price is the median of the N cheapest survivors — N is
    // the operator's per-watch knob (supersedes the fixed median-of-K default).
    const cheapestSample = survivors.slice(0, Math.min(clampedSampleSize, survivors.length));
    const baseline: DealBaseline = {
      amountExalted: median(cheapestSample),
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
