import { Module } from '@nestjs/common';
import { ActivityController } from './activity.controller.js';
import { ActivityService } from './activity.service.js';

/**
 * Operator activity timeline. ActivityService subscribes to the RealtimeBus at
 * bootstrap (DATABASE + RealtimeBus are global), assembling travel→buy→return records.
 */
@Module({
  controllers: [ActivityController],
  providers: [ActivityService],
})
export class ActivityModule {}
