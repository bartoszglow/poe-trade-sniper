import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  MatchedStat,
  PriceCheckDraft,
  PriceCheckItem,
  PriceCheckListing,
  PriceCheckResult,
  PriceCheckStatFilter,
} from '@poe-sniper/shared';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { RateLimitGovernor } from '../ratelimit/rate-limit-governor.js';
import { SearchManager } from '../search/search-manager.js';
import {
  GuardTrippedError,
  NoSessionError,
  TradeApiClient,
} from '../trade-api/trade-api.client.js';
import { errorMessage } from '../util/error-message.js';
import { parseItemText, type ParsedItem } from './item-text-parser.js';
import { detectLanguage, lexiconFor } from './item-language.js';
import { matchModLine, type StatMatch } from './stat-matcher.js';
import { buildDraft } from './price-check-draft.js';
import { buildQueryFromFilters } from './query-from-filters.js';
import { Poe2ScoutClient } from './poe2scout.client.js';
import { TierDataService } from './tier-data.service.js';
import { TradeDataService } from './trade-data.service.js';

const POLICY_SEARCH = 'search';
const POLICY_FETCH = 'fetch';

/**
 * Orchestrates a price check (#37): parse item text into an editable draft (#38),
 * then price it — either a fixed-value item via poe2scout (no GGG cost) or a
 * budget-gated trade2 listings search (D-pc-2). Never throws for an expected
 * outcome — offline / no-session / low-budget become an honest `unavailable`.
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
    @Inject(SearchManager) private readonly searchManager: SearchManager,
    @Inject(TierDataService) private readonly tierData: TierDataService,
  ) {}

  /** The league to price in: the one the operator plays (from watched searches);
   *  with no searches, poe2scout's current temp league (IsCurrent); config last
   *  (#18). A price check has no search context of its own. */
  private async league(): Promise<string> {
    const fromSearches = this.searchManager.getPrimaryLeague();
    if (fromSearches !== null) return fromSearches;
    const current = await this.poe2scout.currentLeague();
    return current ?? this.config.DEFAULT_LEAGUE;
  }

  /**
   * Parse item text into an editable draft (#38 A) — no GGG query, no budget cost.
   * The dictionary may be unavailable before a first successful load (offline);
   * degrade to an all-unmatched draft rather than throwing, so the editor still opens.
   */
  async parse(itemText: string, leagueOverride?: string): Promise<PriceCheckDraft> {
    // Detect the client language from the localized header and parse with its
    // lexicon (#38 C). EN is fully verified; other languages fall back gracefully.
    const parsed = parseItemText(itemText, lexiconFor(detectLanguage(itemText)));
    let compiled: Awaited<ReturnType<TradeDataService['getCompiledStats']>> = [];
    try {
      compiled = await this.tradeData.getCompiledStats();
    } catch (error) {
      if (!(error instanceof NoSessionError)) {
        this.logger.warn(`dictionary load failed: ${errorMessage(error)}`);
      }
    }
    const matched: StatMatch[] = [];
    const unmatched: string[] = [];
    for (const line of parsed.modLines) {
      const match = compiled.length > 0 ? matchModLine(compiled, line) : null;
      if (match) matched.push(match);
      else unmatched.push(line.text);
    }
    const league = leagueOverride ?? (await this.league());
    const baseType = await this.resolveBaseType(parsed);
    return buildDraft({
      item: parsed,
      matched,
      unmatched,
      league,
      baseType,
      tierForRoll: (statId, roll) => this.tierData.tierForRoll(statId, roll),
    });
  }

  /**
   * Only pass a `type` the trade dictionary actually knows (else GGG matches
   * nothing). Rares carry a real base line; magic items bury the base in the
   * affixed name (#19); uniques go by name.
   */
  private async resolveBaseType(parsed: ParsedItem): Promise<string | null> {
    // isKnownItemName / matchBaseType re-enter the dictionary loader, which THROWS
    // (NoSessionError / offline) when there is no cached dictionary. Swallow it so a
    // first-run / offline parse still yields a draft (base-less) instead of a 500 —
    // the getCompiledStats() failure above is already tolerated the same way.
    try {
      const known =
        parsed.baseType && (await this.tradeData.isKnownItemName(parsed.baseType))
          ? parsed.baseType
          : null;
      if (known === null && parsed.name && parsed.rarity?.toLowerCase() === 'magic') {
        return await this.tradeData.matchBaseType(parsed.name);
      }
      return known;
    } catch (error) {
      if (!(error instanceof NoSessionError)) {
        this.logger.warn(`base-type resolve failed: ${errorMessage(error)}`);
      }
      return null;
    }
  }

  /** Price the operator's edited draft (#38 A) — the one-shot check() and the
   *  editor both funnel here, so budget routing/history/decline stay identical. */
  async priceFromDraft(draft: PriceCheckDraft): Promise<PriceCheckResult> {
    const headroom = this.currentHeadroom();
    const item = this.itemFromDraft(draft);
    const nameOrBase = draft.item.name ?? draft.item.baseType;

    // Fixed-value items (currency/runes/uniques) → aggregator, zero GGG traffic.
    if (draft.fixedValue && nameOrBase) {
      const estimate = await this.poe2scout.priceByName(nameOrBase, draft.league);
      return {
        kind: estimate ? 'aggregate' : 'unavailable',
        item,
        estimate,
        listings: [],
        declineReason: estimate ? null : 'no-price-data',
        searchHeadroom: headroom,
      };
    }

    // Rares/magic/bases → live listings, but only if BOTH budgets can spare it.
    if (headroom < this.config.PRICE_CHECK_MIN_SEARCH_HEADROOM) {
      return this.unavailable(item, 'budget-low', headroom);
    }
    const built = buildQueryFromFilters({
      filters: draft.filters,
      rarity: draft.item.rarity,
      name: draft.item.name,
    });
    try {
      const result = await this.tradeApi.priceSearch(
        this.config.DEFAULT_REALM,
        draft.league,
        { query: built.query, sort: built.sort },
        this.config.PRICE_CHECK_LISTING_LIMIT,
        randomUUID(),
      );
      if (result.rateLimited) return this.unavailable(item, 'budget-low', 0);
      const listings: PriceCheckListing[] = result.listings.map((entry) => ({
        price: entry.price,
        seller: entry.seller,
        indexedAt: entry.indexedAt,
        whisper: entry.whisper,
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

  /** One-shot price (hotkey/overlay/paste with defaults): parse → price. */
  async check(itemText: string): Promise<PriceCheckResult> {
    const draft = await this.parse(itemText);
    if (draft.item.name === null && draft.filters.length === 0 && draft.unmatched.length === 0) {
      return this.unavailable(this.itemFromDraft(draft), null, this.currentHeadroom());
    }
    return this.priceFromDraft(draft);
  }

  private currentHeadroom(): number {
    // A rare check spends BOTH a SEARCH and a FETCH slot (POST /search then
    // GET /fetch), so the reserve must protect the tighter of the two (D-pc-2).
    return Math.min(this.governor.headroom(POLICY_SEARCH), this.governor.headroom(POLICY_FETCH));
  }

  private itemFromDraft(draft: PriceCheckDraft): PriceCheckItem {
    const matchedStats: MatchedStat[] = draft.filters
      .filter((filter): filter is PriceCheckStatFilter => filter.kind === 'stat' && filter.enabled)
      .map((filter) => ({ statId: filter.statId, text: filter.text, values: filter.rolls }));
    return {
      name: draft.item.name,
      baseType: draft.item.baseType,
      itemClass: draft.item.itemClass,
      rarity: draft.item.rarity,
      matchedStats,
      unmatchedLines: draft.unmatched,
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
