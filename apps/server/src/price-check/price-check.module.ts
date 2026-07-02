import { Module } from '@nestjs/common';
import { SearchModule } from '../search/search.module.js';
import { PriceCheckController } from './price-check.controller.js';
import { PriceCheckService } from './price-check.service.js';
import { Poe2ScoutClient } from './poe2scout.client.js';
import { TradeDataService } from './trade-data.service.js';

/** Price check (#37): dictionary + parser pipeline + budget-gated trade2/poe2scout.
 *  DB, RateLimitGovernor and TradeApiClient are all @Global; SearchModule is
 *  imported for the primary-league resolver (SearchManager). */
@Module({
  imports: [SearchModule],
  controllers: [PriceCheckController],
  providers: [TradeDataService, Poe2ScoutClient, PriceCheckService],
})
export class PriceCheckModule {}
