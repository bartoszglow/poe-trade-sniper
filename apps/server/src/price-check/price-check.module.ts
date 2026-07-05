import { Module } from '@nestjs/common';
import { MarketDataModule } from '../market-data/market-data.module.js';
import { SearchModule } from '../search/search.module.js';
import { PriceCheckController } from './price-check.controller.js';
import { PriceCheckHistoryService } from './price-check-history.service.js';
import { PriceCheckService } from './price-check.service.js';
import { TierDataService } from './tier-data.service.js';
import { TradeDataService } from './trade-data.service.js';

/** Price check (#37/#38): dictionary + parser pipeline + editable draft +
 *  budget-gated trade2/poe2scout + tier data. DB, RateLimitGovernor and
 *  TradeApiClient are all @Global; SearchModule is imported for the
 *  primary-league resolver (SearchManager); MarketDataModule provides the
 *  Poe2ScoutClient (extracted per plan 41 D-dw-3). */
@Module({
  imports: [MarketDataModule, SearchModule],
  controllers: [PriceCheckController],
  providers: [TradeDataService, TierDataService, PriceCheckService, PriceCheckHistoryService],
})
export class PriceCheckModule {}
