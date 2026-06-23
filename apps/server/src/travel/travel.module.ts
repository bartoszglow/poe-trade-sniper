import { Module } from '@nestjs/common';
import { SearchModule } from '../search/search.module.js';
import { TravelController } from './travel.controller.js';
import { TravelService } from './travel.service.js';
import { GameFocusService } from './game-focus.service.js';

@Module({
  imports: [SearchModule],
  controllers: [TravelController],
  providers: [TravelService, GameFocusService],
  exports: [TravelService],
})
export class TravelModule {}
