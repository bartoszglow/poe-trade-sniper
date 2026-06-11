import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { SearchModule } from '../search/search.module.js';
import { CorrelationIdMiddleware } from './correlation-id.middleware.js';
import { HealthController } from './health.controller.js';
import { SearchesController } from './searches.controller.js';
import { StatusController } from './status.controller.js';

@Module({
  imports: [SearchModule],
  controllers: [HealthController, SearchesController, StatusController],
})
export class ApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
