import { Global, Module } from '@nestjs/common';
import { TradeApiClient } from './trade-api.client.js';

@Global()
@Module({
  providers: [TradeApiClient],
  exports: [TradeApiClient],
})
export class TradeApiModule {}
