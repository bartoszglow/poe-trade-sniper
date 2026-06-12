import { Global, Module } from '@nestjs/common';
import { NetworkController } from './network.controller.js';
import { NetworkLog } from './network-log.service.js';

/** Global so TradeApiClient and the engine registry can inject NetworkLog. */
@Global()
@Module({
  controllers: [NetworkController],
  providers: [NetworkLog],
  exports: [NetworkLog],
})
export class NetworkModule {}
