import { Controller, Get, Inject, Post } from '@nestjs/common';
import { OutboundGuard, type GuardStatus } from './outbound-guard.js';

@Controller('guard')
export class GuardController {
  constructor(@Inject(OutboundGuard) private readonly guard: OutboundGuard) {}

  @Get()
  status(): GuardStatus {
    return this.guard.status();
  }

  /** Operator-only re-arm after investigating what tripped it. */
  @Post('reset')
  reset(): GuardStatus {
    return this.guard.reset();
  }
}
