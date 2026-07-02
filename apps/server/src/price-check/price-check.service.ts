import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  MatchedStat,
  PriceCheckItem,
  PriceCheckResult,
  PriceCheckListing,
} from '@poe-sniper/shared';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { RateLimitGovernor } from '../ratelimit/rate-limit-governor.js';
import {
  GuardTrippedError,
  NoSessionError,
  TradeApiClient,
} from '../trade-api/trade-api.client.js';
import { errorMessage } from '../util/error-message.js';
import { parseItemText } from './item-text-parser.js';
import { matchModLine } from './stat-matcher.js';
import { buildQuery, isFixedValueItem } from './query-builder.js';
import { Poe2ScoutClient } from './poe2scout.client.js';
import { TradeDataService } from './trade-data.service.js';

const POLICY_SEARCH = 'search';
const POLICY_FETCH = 'fetch';

/**
 * Orchestrates a price check (#37): parse item text → match stats → either
 * price a fixed-value item via poe2scout (no GGG cost) or run a budget-gated
 * trade2 listings search (D-pc-2). Never throws for an expected outcome —
 * offline / no-session / low-budget become an honest `unavailable` result.
 */
@Injectable()
export class PriceCheckService {
  private readonly logger = new Logger(PriceCheckService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(TradeDataService) private readonly tradeData: TradeDataService,
    @Inject(Poe2ScoutClient) private readonly poe2scout: Poe2ScoutClient,
    @Inject(TradeApiClient) private readonly tradeApi: TradeApiClient,
    @Inject(RateLimitGovernor) private readonly governor: RateLimitGovernor,
  ) {}

  async check(itemText: string): Promise<PriceCheckResult> {
    // A rare check spends BOTH a SEARCH and a FETCH slot (POST /search then
    // GET /fetch), so the reserve must protect the tighter of the two — a
    // price check must not push either bucket to the near-limit hold that would
    // then delay detection's per-hit fetch (D-pc-2).
    const headroom = Math.min(
      this.governor.headroom(POLICY_SEARCH),
      this.governor.headroom(POLICY_FETCH),
    );
    const parsed = parseItemText(itemText);
    if (!parsed.name && parsed.modLines.length === 0) {
      return this.unavailable(this.emptyItem(parsed), null, headroom);
    }

    // The dictionary fetch needs a session too; a first-ever check while
    // offline / logged-out must degrade honestly, not 500.
    let compiled;
    try {
      compiled = await this.tradeData.getCompiledStats();
    } catch (error) {
      if (error instanceof NoSessionError) {
        return this.unavailable(this.emptyItem(parsed), 'no-session', headroom);
      }
      this.logger.warn(`dictionary load failed: ${errorMessage(error)}`);
      return this.unavailable(this.emptyItem(parsed), null, headroom);
    }
    const matchedStats: MatchedStat[] = [];
    const unmatchedLines: string[] = [];
    for (const line of parsed.modLines) {
      const match = matchModLine(compiled, line);
      if (match)
        matchedStats.push({ statId: match.statId, text: match.text, values: match.values });
      else unmatchedLines.push(line.text);
    }
    const item: PriceCheckItem = {
      name: parsed.name,
      baseType: parsed.baseType,
      itemClass: parsed.itemClass,
      rarity: parsed.rarity,
      matchedStats,
      unmatchedLines,
    };

    // Fixed-value items (currency/runes/uniques) → aggregator, zero GGG traffic.
    if (isFixedValueItem(parsed.rarity, parsed.itemClass) && (parsed.name ?? parsed.baseType)) {
      const estimate = await this.poe2scout.priceByName((parsed.name ?? parsed.baseType)!);
      return {
        kind: estimate ? 'aggregate' : 'unavailable',
        item,
        estimate,
        listings: [],
        declineReason: null,
        searchHeadroom: headroom,
      };
    }

    // Rares/magic/bases → live listings, but only if BOTH budgets can spare it.
    // Below the reserve, decline rather than starve detection (D-pc-2).
    if (headroom < this.config.PRICE_CHECK_MIN_SEARCH_HEADROOM) {
      return this.unavailable(item, 'budget-low', headroom);
    }
    // A magic item's "name" is the AFFIXED base (e.g. "Flaring Coral Ring of
    // the Drake"), not a searchable base type — only pass a `type` the trade
    // dictionary actually knows, else GGG matches nothing. Rares carry a real
    // base line; uniques go by name. Drop an unknown base and rely on stats.
    const baseType =
      parsed.baseType && (await this.tradeData.isKnownItemName(parsed.baseType))
        ? parsed.baseType
        : null;
    const built = buildQuery({
      rarity: parsed.rarity,
      name: parsed.name,
      baseType,
      itemLevel: parsed.itemLevel,
      quality: parsed.quality,
      corrupted: parsed.corrupted,
      matchedStats,
    });
    try {
      const result = await this.tradeApi.priceSearch(
        this.config.DEFAULT_REALM,
        this.config.DEFAULT_LEAGUE,
        { query: built.query, sort: built.sort },
        this.config.PRICE_CHECK_LISTING_LIMIT,
        randomUUID(),
      );
      if (result.rateLimited) return this.unavailable(item, 'budget-low', 0);
      const listings: PriceCheckListing[] = result.listings.map((entry) => ({
        price: entry.price,
        seller: entry.seller,
        indexedAt: entry.indexedAt,
      }));
      return {
        kind: 'listings',
        item,
        estimate: null,
        listings,
        declineReason: null,
        searchHeadroom: headroom,
      };
    } catch (error) {
      if (error instanceof NoSessionError) return this.unavailable(item, 'no-session', headroom);
      if (error instanceof GuardTrippedError) {
        return this.unavailable(item, 'guard-tripped', headroom);
      }
      this.logger.warn(`price search failed: ${errorMessage(error)}`);
      return this.unavailable(item, null, headroom);
    }
  }

  private emptyItem(parsed: ReturnType<typeof parseItemText>): PriceCheckItem {
    return {
      name: parsed.name,
      baseType: parsed.baseType,
      itemClass: parsed.itemClass,
      rarity: parsed.rarity,
      matchedStats: [],
      unmatchedLines: [],
    };
  }

  private unavailable(
    item: PriceCheckItem,
    declineReason: PriceCheckResult['declineReason'],
    headroom: number,
  ): PriceCheckResult {
    return {
      kind: 'unavailable',
      item,
      estimate: null,
      listings: [],
      declineReason,
      searchHeadroom: headroom,
    };
  }
}
