import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DATABASE } from '../db/db.module.js';
import type { SniperDatabase } from '../db/migrate.js';
import { appState } from '../db/schema.js';
import { TradeApiClient } from '../trade-api/trade-api.client.js';
import { errorMessage } from '../util/error-message.js';
import { compileStats, type CompiledStat, type StatEntry } from './stat-matcher.js';
import {
  DICTIONARY_SCHEMA_VERSION,
  diffDictionary,
  needsRebuild,
  summarizeDiff,
  type ItemDef,
  type StatDef,
  type StaticDef,
  type TradeDictionary,
} from './dictionary-schema.js';

/** Cached under this app_state key (#37, D-pc-3). */
const CACHE_KEY = 'price-check-dictionary';
/** League data barely changes mid-league; a week keeps it fresh across a launch. */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Tier-1 price-check dictionary (#37, D-pc-3): the comprehensive, versioned,
 * diffable `TradeDictionary` (see dictionary-schema.ts) built from GGG's own
 * `/api/trade2/data/*` endpoints — the same source the official trade site
 * uses, so it is correct on league-launch day with no app release. Cached in
 * app_state and refreshed lazily; each refresh is DIFFED against the cache and
 * logged, then the derived views (compiled matchers, item-name set) are rebuilt.
 */
@Injectable()
export class TradeDataService {
  private readonly logger = new Logger(TradeDataService.name);
  private dictionary: TradeDictionary | null = null;
  private compiled: CompiledStat[] | null = null;
  private itemKeys = new Set<string>();
  private loading: Promise<void> | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly database: SniperDatabase,
    @Inject(TradeApiClient) private readonly tradeApi: TradeApiClient,
  ) {}

  /** Compiled stat matchers, loading (and refreshing if stale) on first use. */
  async getCompiledStats(): Promise<CompiledStat[]> {
    await this.ensureLoaded();
    return this.compiled ?? [];
  }

  /** True when `name` is a known base type / unique (case-insensitive). */
  async isKnownItemName(name: string): Promise<boolean> {
    await this.ensureLoaded();
    return this.itemKeys.has(name.trim().toLowerCase());
  }

  /** The current dictionary snapshot (metadata for the UI / diagnostics). */
  async getDictionary(): Promise<TradeDictionary | null> {
    await this.ensureLoaded();
    return this.dictionary;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.compiled) return;
    if (this.loading) return this.loading;
    this.loading = this.load().finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async load(): Promise<void> {
    const cached = this.readCache();
    if (!needsRebuild(cached, Date.now(), CACHE_TTL_MS)) {
      this.apply(cached!);
      return;
    }
    try {
      const fresh = await this.fetchFromGgg();
      const diff = diffDictionary(cached, fresh);
      if (diff.identical && cached) {
        // Same data — just refresh the fetch timestamp, keep the cache.
        this.apply(cached);
        this.touchCache(cached);
        return;
      }
      this.logger.log(
        `dictionary ${cached ? 'updated' : 'built'}: ${summarizeDiff(diff)}` +
          (diff.schemaChanged ? ' (schema bumped → full rebuild)' : ''),
      );
      this.writeCache(fresh);
      this.apply(fresh);
    } catch (error) {
      // Offline / no session / rate-limited: fall back to any cache, even one
      // whose schema is current but stale, so a check still works.
      this.logger.warn(`dictionary refresh failed: ${errorMessage(error)}`);
      if (cached) this.apply(cached);
      else throw error;
    }
  }

  private apply(dictionary: TradeDictionary): void {
    this.dictionary = dictionary;
    const statEntries: StatEntry[] = dictionary.stats.map((stat) => ({
      id: stat.id,
      text: stat.text,
      type: stat.type,
    }));
    this.compiled = compileStats(statEntries);
    this.itemKeys = new Set(dictionary.items.map((item) => item.key));
  }

  private async fetchFromGgg(): Promise<TradeDictionary> {
    const correlationId = randomUUID();
    const stats = this.parseStats(await this.tradeApi.fetchTradeData('stats', correlationId));
    const items = this.parseItems(await this.tradeApi.fetchTradeData('items', correlationId));
    const statics = this.parseStatics(await this.tradeApi.fetchTradeData('static', correlationId));
    const fetchedAt = new Date().toISOString();
    return {
      meta: {
        schemaVersion: DICTIONARY_SCHEMA_VERSION,
        // No league/patch tag on these endpoints — the fetch date is the data
        // version until a Tier-2 pipeline supplies the real patch string.
        dataVersion: fetchedAt.slice(0, 10),
        realm: this.config.DEFAULT_REALM,
        league: this.config.DEFAULT_LEAGUE,
        fetchedAt,
        counts: { stats: stats.length, items: items.length, statics: statics.length },
      },
      stats,
      items,
      statics,
    };
  }

  private parseStats(raw: unknown): StatDef[] {
    const payload = raw as {
      result?: Array<{
        entries?: Array<{
          id?: string;
          text?: string;
          type?: string;
          option?: { options?: Array<{ id?: number | string; text?: string }> };
        }>;
      }>;
    };
    const stats: StatDef[] = [];
    for (const group of payload.result ?? []) {
      for (const entry of group.entries ?? []) {
        if (typeof entry.id !== 'string' || typeof entry.text !== 'string') continue;
        stats.push({
          id: entry.id,
          text: entry.text,
          type: entry.type ?? '',
          placeholders: (entry.text.match(/#/g) ?? []).length,
          options: (entry.option?.options ?? [])
            .filter((option) => option.id !== undefined && option.text !== undefined)
            .map((option) => ({ value: String(option.id), text: String(option.text) })),
        });
      }
    }
    return stats;
  }

  private parseItems(raw: unknown): ItemDef[] {
    const payload = raw as {
      result?: Array<{
        id?: string;
        entries?: Array<{ name?: string; type?: string; flags?: { unique?: boolean } }>;
      }>;
    };
    const items: ItemDef[] = [];
    const seen = new Set<string>();
    for (const group of payload.result ?? []) {
      const category = typeof group.id === 'string' ? group.id : null;
      for (const entry of group.entries ?? []) {
        const displayName = entry.name ?? entry.type;
        if (!displayName || typeof entry.type !== 'string') continue;
        const key = displayName.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          key,
          name: displayName,
          baseType: entry.name ? entry.type : null,
          category,
          flags: {
            unique: entry.flags?.unique === true || entry.name !== undefined,
            gem: category?.includes('gem') ?? false,
          },
        });
        // Also index the bare base type so a Normal/Magic item matches by base.
        if (entry.name && !seen.has(entry.type.toLowerCase())) {
          seen.add(entry.type.toLowerCase());
          items.push({
            key: entry.type.toLowerCase(),
            name: entry.type,
            baseType: entry.type,
            category,
            flags: { unique: false, gem: category?.includes('gem') ?? false },
          });
        }
      }
    }
    return items;
  }

  private parseStatics(raw: unknown): StaticDef[] {
    const payload = raw as {
      result?: Array<{ id?: string; entries?: Array<{ id?: string; text?: string }> }>;
    };
    const statics: StaticDef[] = [];
    for (const group of payload.result ?? []) {
      const category = typeof group.id === 'string' ? group.id : null;
      for (const entry of group.entries ?? []) {
        if (typeof entry.id === 'string' && typeof entry.text === 'string') {
          statics.push({ id: entry.id, text: entry.text, category });
        }
      }
    }
    return statics;
  }

  private readCache(): TradeDictionary | null {
    const row = this.database.select().from(appState).where(eq(appState.key, CACHE_KEY)).get();
    return row ? (row.value as TradeDictionary) : null;
  }

  private writeCache(dictionary: TradeDictionary): void {
    const updatedAt = new Date().toISOString();
    this.database
      .insert(appState)
      .values({ key: CACHE_KEY, value: dictionary, updatedAt })
      .onConflictDoUpdate({ target: appState.key, set: { value: dictionary, updatedAt } })
      .run();
  }

  /** Same data on refresh — bump the fetch time so we don't re-fetch each load. */
  private touchCache(dictionary: TradeDictionary): void {
    this.writeCache({
      ...dictionary,
      meta: { ...dictionary.meta, fetchedAt: new Date().toISOString() },
    });
  }
}
