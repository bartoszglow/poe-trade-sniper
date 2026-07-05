import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { DealWatchModule } from '../deal-watch/deal-watch.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { SearchModule } from '../search/search.module.js';
import { TravelModule } from '../travel/travel.module.js';
import { CorrelationIdMiddleware } from './correlation-id.middleware.js';
import { HostGuardMiddleware } from './host-guard.middleware.js';
import { HealthController } from './health.controller.js';
import { LeaguesController } from './leagues.controller.js';
import { RoomsController } from './rooms.controller.js';
import { SearchesController } from './searches.controller.js';
import { StatsController } from './stats.controller.js';
import { StatusController } from './status.controller.js';

@Module({
  imports: [SearchModule, TravelModule, PermissionsModule, DealWatchModule],
  controllers: [
    HealthController,
    LeaguesController,
    RoomsController,
    SearchesController,
    StatsController,
    StatusController,
  ],
})
export class ApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HostGuardMiddleware, CorrelationIdMiddleware).forRoutes('*');
  }
}
