import { Controller, Get, Inject } from '@nestjs/common';
import type { AppSettings, PermissionsStatus, SessionPublicStatus } from '@poe-sniper/shared';
import { OutboundGuard, type GuardStatus } from '../guard/outbound-guard.js';
import { PermissionGateService } from '../permissions/permission-gate.service.js';
import { PermissionsService } from '../permissions/permissions.service.js';
import { RateLimitGovernor, type GovernorStatus } from '../ratelimit/rate-limit-governor.js';
import { SearchManager } from '../search/search-manager.js';
import { SessionService } from '../session/session.service.js';
import { AppSettingsService } from '../settings/app-settings.service.js';
import { TravelService, type TravelStatus } from '../travel/travel.service.js';

interface StatusResponse {
  session: SessionPublicStatus;
  rateLimit: GovernorStatus;
  searches: { total: number; byStatus: Record<string, number> };
  travel: TravelStatus;
  guard: GuardStatus;
  /** Live OS permission state + derived capabilities (single source of truth for the UI). */
  permissions: PermissionsStatus;
  capabilities: { canCapture: boolean; canControl: boolean };
  /** User-tunable settings (cursor mode, …) — drives the Settings UI off the poll. */
  settings: AppSettings;
  /** First-run funnel signals (durable, survive a search delete). */
  onboarding: { firstHitReceived: boolean };
}

@Controller('status')
export class StatusController {
  constructor(
    @Inject(SessionService) private readonly sessionService: SessionService,
    @Inject(RateLimitGovernor) private readonly governor: RateLimitGovernor,
    @Inject(SearchManager) private readonly searchManager: SearchManager,
    @Inject(TravelService) private readonly travelService: TravelService,
    @Inject(OutboundGuard) private readonly guard: OutboundGuard,
    @Inject(PermissionsService) private readonly permissions: PermissionsService,
    @Inject(PermissionGateService) private readonly gate: PermissionGateService,
    @Inject(AppSettingsService) private readonly settings: AppSettingsService,
  ) {}

  @Get()
  status(): StatusResponse {
    return {
      session: this.sessionService.publicStatus(),
      rateLimit: this.governor.status,
      searches: this.searchManager.summary(),
      travel: this.travelService.status(),
      guard: this.guard.status(),
      permissions: this.permissions.status(),
      capabilities: { canCapture: this.gate.canCapture(), canControl: this.gate.canControl() },
      settings: this.settings.get(),
      onboarding: { firstHitReceived: this.searchManager.hasEverReceivedHit() },
    };
  }
}
