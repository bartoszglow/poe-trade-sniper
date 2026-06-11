import { randomUUID } from 'node:crypto';
import { BadRequestException, Controller, Get, Inject } from '@nestjs/common';
import type { LeagueInfo } from '@poe-sniper/shared';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { NoSessionError, TradeApiClient } from '../trade-api/trade-api.client.js';

/** Leagues change once per ~4-month cycle — cache and spare the budget. */
@Controller('leagues')
export class LeaguesController {
  private cache: { leagues: LeagueInfo[]; fetchedAtMs: number } | null = null;

  constructor(
    @Inject(TradeApiClient) private readonly tradeApi: TradeApiClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get()
  async leagues(): Promise<LeagueInfo[]> {
    if (this.cache && Date.now() - this.cache.fetchedAtMs < this.config.LEAGUE_CACHE_TTL_MS) {
      return this.cache.leagues;
    }
    try {
      const leagues = await this.tradeApi.fetchLeagues(randomUUID());
      this.cache = { leagues, fetchedAtMs: Date.now() };
      return leagues;
    } catch (error) {
      if (error instanceof NoSessionError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
