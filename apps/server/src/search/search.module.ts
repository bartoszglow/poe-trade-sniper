import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { OutboundGuard } from '../guard/outbound-guard.js';
import { NetworkLog } from '../network/network-log.service.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { SessionService } from '../session/session.service.js';
import { TradeApiClient } from '../trade-api/trade-api.client.js';
import { buildEngineRegistry, ENGINE_REGISTRY } from './engine-registry.js';
import { LiveOfferRegistry } from './live-offer-registry.js';
import { SearchManager } from './search-manager.js';

@Module({
  imports: [PermissionsModule],
  providers: [
    {
      provide: ENGINE_REGISTRY,
      inject: [APP_CONFIG, TradeApiClient, SessionService, OutboundGuard, NetworkLog],
      useFactory: (
        config: AppConfig,
        tradeApi: TradeApiClient,
        sessionService: SessionService,
        guard: OutboundGuard,
        networkLog: NetworkLog,
      ) => buildEngineRegistry(config, tradeApi, sessionService, guard, networkLog),
    },
    LiveOfferRegistry,
    SearchManager,
  ],
  exports: [SearchManager],
})
export class SearchModule {}
