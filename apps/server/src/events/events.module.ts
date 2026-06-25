import { Global, Module } from '@nestjs/common';
import { BuySessionLock } from './buy-session-lock.service.js';
import { EventsController } from './events.controller.js';
import { RealtimeBus } from './realtime-bus.js';

@Global()
@Module({
  controllers: [EventsController],
  providers: [RealtimeBus, BuySessionLock],
  exports: [RealtimeBus, BuySessionLock],
})
export class EventsModule {}
