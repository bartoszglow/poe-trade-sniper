import { Module } from '@nestjs/common';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { SearchModule } from '../search/search.module.js';
import { BuyAutomationService } from './buy-automation.service.js';

/**
 * Buy automation orchestrator (Phase 2). Subscribes to the RealtimeBus at
 * bootstrap; depends on SearchManager (the auto-buy flag) + the capability gate
 * + the global platform ports. No native deps — capture/vision/input live
 * behind the ports, so this module stays cross-platform.
 */
@Module({
  imports: [SearchModule, PermissionsModule],
  providers: [BuyAutomationService],
})
export class BuyAutomationModule {}
