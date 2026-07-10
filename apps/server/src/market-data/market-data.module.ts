import { Module } from '@nestjs/common';
import { ExchangeRatesService } from './exchange-rates.service.js';
import { Poe2ScoutClient } from './poe2scout.client.js';

/**
 * Market data behind price-check and deal-watch. Two sources:
 * - `ExchangeRatesService` — currency rates from GGG's own bulk Currency
 *   Exchange (D-dw-21; its own GGG rate-limit policy, via TradeApiClient).
 *   Feeds deal-watch normalization + the divine↔exalted unit rate.
 * - `Poe2ScoutClient` — fixed-value item prices by NAME for price-check (#37).
 *   Its rate methods went dead when poe2scout's API 404'd (2026-07-10) and
 *   deal-watch no longer calls them; the name-lookup rework is parked until
 *   their new API surfaces.
 * Conversion math itself is pure and lives in `currency-rates.ts` (one
 * implementation, review F12).
 */
@Module({
  providers: [Poe2ScoutClient, ExchangeRatesService],
  exports: [Poe2ScoutClient, ExchangeRatesService],
})
export class MarketDataModule {}
