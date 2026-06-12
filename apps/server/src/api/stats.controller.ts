import { randomUUID } from 'node:crypto';
import { BadRequestException, Controller, Get, Inject } from '@nestjs/common';
import type { StatDictionaryEntry } from '@poe-sniper/shared';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { NoSessionError, TradeApiClient } from '../trade-api/trade-api.client.js';

/**
 * Stat dictionary (query stat id → human label) for the criteria view.
 * Static game data — one GGG call per cache window, never per render.
 */
@Controller('stats')
export class StatsController {
  private cache: { entries: StatDictionaryEntry[]; fetchedAtMs: number } | null = null;

  constructor(
    @Inject(TradeApiClient) private readonly tradeApi: TradeApiClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get()
  async stats(): Promise<StatDictionaryEntry[]> {
    if (this.cache && Date.now() - this.cache.fetchedAtMs < this.config.STATS_CACHE_TTL_MS) {
      return this.cache.entries;
    }
    try {
      const entries = await this.tradeApi.fetchStatsDictionary(randomUUID());
      this.cache = { entries, fetchedAtMs: Date.now() };
      return entries;
    } catch (error) {
      if (error instanceof NoSessionError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
