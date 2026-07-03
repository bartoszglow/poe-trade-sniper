import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { ListingPrice } from '@poe-sniper/shared';
import { errorMessage } from '../util/error-message.js';
import { FetchFunction, HTTP_FETCH } from '../trade-api/trade-api.client.js';

/** The real poe2scout API base (verified 2026-07-03; see docs/integration). */
const BASE_URL = 'https://api.poe2scout.com/api/poe2';
/** Fixed-value prices barely move within a check session; cache generously. */
const CACHE_TTL_MS = 15 * 60 * 1000;
/** Bound the cache — insertion-order eviction keeps memory flat over a session. */
const CACHE_MAX_ENTRIES = 500;
/** Currency categories poe2scout groups fixed-value stackables under. */
const CURRENCY_CATEGORIES = ['currency', 'fragments', 'runes', 'essences', 'omen', 'catalysts'];
/** Deadline for every poe2scout fetch — a stalled upstream must degrade to null,
 *  never hang the price-check handler (matches the trade-api OUTBOUND_TIMEOUT_MS). */
const POE2SCOUT_TIMEOUT_MS = 15_000;

interface CacheEntry {
  at: number;
  price: ListingPrice | null;
}

/**
 * Fixed-value item prices from the poe2scout aggregator (#37, D-pc-4).
 * NON-GGG host — never touches the trade rate-limit budget. Uniques come from
 * the `Items` search endpoint; currency/runes/essences from `Currencies`.
 * Prices are in the league base currency (exalted). Best-effort: any failure
 * returns null and the caller shows an "unpriced" state rather than erroring.
 */
@Injectable()
export class Poe2ScoutClient {
  private readonly logger = new Logger(Poe2ScoutClient.name);
  private readonly fetchFn: FetchFunction;
  private readonly cache = new Map<string, CacheEntry>();
  /** Per-league currency name→price map, cached (the currency lists are small). */
  private readonly currencyCache = new Map<string, { at: number; prices: Map<string, number> }>();
  /** The current temp league (IsCurrent), cached — rarely changes within a session. */
  private currentLeagueCache: { at: number; league: string | null } | null = null;

  constructor(@Optional() @Inject(HTTP_FETCH) fetchFn: FetchFunction | null) {
    this.fetchFn = fetchFn ?? fetch;
  }

  /**
   * Best-effort price for a fixed-value item by name, in the given league.
   * Returns the aggregate in exalted, or null when unknown/offline.
   */
  async priceByName(name: string, league: string): Promise<ListingPrice | null> {
    const trimmed = name.trim();
    const key = `${league}::${trimmed.toLowerCase()}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.price;
    let price: ListingPrice | null = null;
    try {
      price = await this.lookup(trimmed, league);
    } catch (error) {
      this.logger.debug(`poe2scout lookup failed for "${name}": ${errorMessage(error)}`);
    }
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { at: Date.now(), price });
    return price;
  }

  /**
   * The current temporary league per poe2scout (`IsCurrent`) — the fallback when
   * the operator has no watched searches to infer a league from (#18), so a
   * first-time user still prices against the live league, not config 'Standard'.
   * Best-effort: returns null on any failure and the caller falls back to config.
   */
  async currentLeague(): Promise<string | null> {
    if (this.currentLeagueCache && Date.now() - this.currentLeagueCache.at < CACHE_TTL_MS) {
      return this.currentLeagueCache.league;
    }
    let league: string | null = null;
    try {
      const response = await this.fetchFn(`${BASE_URL}/Leagues`, {
        headers: { accept: 'application/json' },
      });
      if (response.ok) {
        const payload = (await response.json()) as
          | Array<{ Value?: string; IsCurrent?: boolean }>
          | { Items?: Array<{ Value?: string; IsCurrent?: boolean }> };
        const leagues = Array.isArray(payload) ? payload : (payload.Items ?? []);
        const current = leagues.find((entry) => entry.IsCurrent === true) ?? leagues[0];
        league = typeof current?.Value === 'string' ? current.Value : null;
      }
    } catch (error) {
      this.logger.debug(`poe2scout leagues failed: ${errorMessage(error)}`);
    }
    this.currentLeagueCache = { at: Date.now(), league };
    return league;
  }

  private async lookup(name: string, league: string): Promise<ListingPrice | null> {
    const currencyPrice = await this.currencyPrice(name, league);
    if (currencyPrice !== null) return { amount: currencyPrice, currency: 'exalted' };
    const itemPrice = await this.itemPrice(name, league);
    if (itemPrice !== null) return { amount: itemPrice, currency: 'exalted' };
    return null;
  }

  /** Unique/base price via the Items search endpoint (exact name match). */
  private async itemPrice(name: string, league: string): Promise<number | null> {
    const url = `${BASE_URL}/Leagues/${encodeURIComponent(league)}/Items?search=${encodeURIComponent(name)}&perPage=20&page=1`;
    const response = await this.fetchFn(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(POE2SCOUT_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as
      | Array<{ Name?: string; Text?: string; Type?: string; CurrentPrice?: number }>
      | { Items?: Array<{ Name?: string; Text?: string; CurrentPrice?: number }> };
    const items = Array.isArray(payload) ? payload : (payload.Items ?? []);
    const target = name.toLowerCase();
    const match = items.find(
      (item) =>
        (item.Name ?? '').toLowerCase() === target || (item.Text ?? '').toLowerCase() === target,
    );
    return typeof match?.CurrentPrice === 'number' && match.CurrentPrice > 0
      ? match.CurrentPrice
      : null;
  }

  /** Currency price via the per-league currency map (cached across categories). */
  private async currencyPrice(name: string, league: string): Promise<number | null> {
    const map = await this.currencyMap(league);
    return map.get(name.toLowerCase()) ?? null;
  }

  private async currencyMap(league: string): Promise<Map<string, number>> {
    const cached = this.currencyCache.get(league);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.prices;
    const prices = new Map<string, number>();
    for (const category of CURRENCY_CATEGORIES) {
      try {
        const url = `${BASE_URL}/Leagues/${encodeURIComponent(league)}/Currencies/ByCategory?Category=${category}&perPage=300&page=1`;
        const response = await this.fetchFn(url, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(POE2SCOUT_TIMEOUT_MS),
        });
        if (!response.ok) continue;
        const payload = (await response.json()) as {
          Items?: Array<{ Text?: string; CurrentPrice?: number }>;
        };
        for (const item of payload.Items ?? []) {
          if (typeof item.Text === 'string' && typeof item.CurrentPrice === 'number') {
            prices.set(item.Text.toLowerCase(), item.CurrentPrice);
          }
        }
      } catch (error) {
        this.logger.debug(`poe2scout currency ${category} failed: ${errorMessage(error)}`);
      }
    }
    this.currencyCache.set(league, { at: Date.now(), prices });
    return prices;
  }
}
