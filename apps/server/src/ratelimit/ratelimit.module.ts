import { Global, Module } from '@nestjs/common';
import { RateLimitGovernor } from './rate-limit-governor.js';

@Global()
@Module({
  providers: [RateLimitGovernor],
  exports: [RateLimitGovernor],
})
export class RateLimitModule {}
