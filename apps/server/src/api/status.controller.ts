import { Controller, Get, Inject } from '@nestjs/common';
import type { SessionPublicStatus } from '@poe-sniper/shared';
import { RateLimitGovernor, type GovernorStatus } from '../ratelimit/rate-limit-governor.js';
import { SearchManager } from '../search/search-manager.js';
import { SessionService } from '../session/session.service.js';
import { TravelService, type TravelStatus } from '../travel/travel.service.js';

interface StatusResponse {
  session: SessionPublicStatus;
  rateLimit: GovernorStatus;
  searches: { total: number; byStatus: Record<string, number> };
  travel: TravelStatus;
}

@Controller('status')
export class StatusController {
  constructor(
    @Inject(SessionService) private readonly sessionService: SessionService,
    @Inject(RateLimitGovernor) private readonly governor: RateLimitGovernor,
    @Inject(SearchManager) private readonly searchManager: SearchManager,
    @Inject(TravelService) private readonly travelService: TravelService,
  ) {}

  @Get()
  status(): StatusResponse {
    return {
      session: this.sessionService.publicStatus(),
      rateLimit: this.governor.status,
      searches: this.searchManager.summary(),
      travel: this.travelService.status(),
    };
  }
}
