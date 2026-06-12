import { Global, Module } from '@nestjs/common';
import { GuardController } from './guard.controller.js';
import { OutboundGuard } from './outbound-guard.js';

@Global()
@Module({
  controllers: [GuardController],
  providers: [OutboundGuard],
  exports: [OutboundGuard],
})
export class GuardModule {}
