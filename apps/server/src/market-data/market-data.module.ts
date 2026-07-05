import { Module } from '@nestjs/common';
import { Poe2ScoutClient } from './poe2scout.client.js';

/**
 * Market data from the poe2scout aggregator (NON-GGG, off the trade budget):
 * fixed-value item prices, ApiId-keyed exchange rates and the DivinePrice
 * unit rate. Extracted from PriceCheckModule when deal-watch became the
 * second consumer (plan 41, D-dw-3) — both PriceCheckModule and
 * DealWatchModule import this module. Conversion math itself is pure and
 * lives in `currency-rates.ts` (one implementation, review F12).
 */
@Module({
  providers: [Poe2ScoutClient],
  exports: [Poe2ScoutClient],
})
export class MarketDataModule {}
