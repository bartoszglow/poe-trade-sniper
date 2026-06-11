import { Global, Module } from '@nestjs/common';
import { EventsController } from './events.controller.js';
import { RealtimeBus } from './realtime-bus.js';

@Global()
@Module({
  controllers: [EventsController],
  providers: [RealtimeBus],
  exports: [RealtimeBus],
})
export class EventsModule {}
