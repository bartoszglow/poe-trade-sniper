import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { CorrelationIdMiddleware } from './correlation-id.middleware.js';
import { HealthController } from './health.controller.js';

@Module({
  controllers: [HealthController],
})
export class ApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
