import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { SearchModule } from '../search/search.module.js';
import { TravelModule } from '../travel/travel.module.js';
import { BuyAutomationService } from './buy-automation.service.js';
import { BuyController } from './buy.controller.js';

/**
 * Buy automation orchestrator (Phase 2). Subscribes to the RealtimeBus at
 * bootstrap; depends on SearchManager (the auto-buy flag) + the capability gate
 * + the global platform ports. The manual Buy endpoint reuses TravelService to
 * enqueue the travel (buy = travel + grab). No native deps — capture/vision/input
 * live behind the ports, so this module stays cross-platform.
 */
@Module({
  imports: [SearchModule, PermissionsModule, TravelModule],
  controllers: [BuyController],
  providers: [BuyAutomationService],
})
export class BuyAutomationModule {}
