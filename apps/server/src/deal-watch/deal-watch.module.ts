import { Module } from '@nestjs/common';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { SearchModule } from '../search/search.module.js';
import { DealBaselineService } from './deal-baseline.service.js';
import { DealHistoryService } from './deal-history.service.js';
import { DealWatchService } from './deal-watch.service.js';

/**
 * Deal-watch (plan 41): in-place discount sniping on a managed search. Imports
 * SearchModule for the deal seam + decorator registry (the decorator is
 * self-registered in DealWatchService.onModuleInit — one dependency direction,
 * no forwardRef) and MarketDataModule for currency rates.
 */
@Module({
  imports: [SearchModule, MarketDataModule],
  providers: [DealBaselineService, DealHistoryService, DealWatchService],
  exports: [DealWatchService],
})
export class DealWatchModule {}
