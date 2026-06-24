import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Inject,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import { PermissionGateService } from '../permissions/permission-gate.service.js';
import { TravelService } from '../travel/travel.service.js';
import { BuyAutomationService } from './buy-automation.service.js';

/**
 * Manual buy from a live hit — a one-shot "travel there AND grab the item". It
 * marks the listing for buy-on-arrival, then enqueues the SAME travel as the
 * Travel button, so the buy pipeline runs on travel success even when the
 * search's autoBuy toggle is off (D-19). Gated on the macOS control permission,
 * re-checked here because UI gating is not authoritative (a grant can be revoked
 * between render and click).
 */
const buySchema = z.object({
  token: z.string().min(20),
  realm: z.string().min(1),
  league: z.string().min(1),
  searchId: z.string().min(1),
  listingId: z.string().min(1),
  itemName: z.string().min(1).optional(),
});

@Controller('buy')
export class BuyController {
  constructor(
    @Inject(PermissionGateService) private readonly gate: PermissionGateService,
    @Inject(TravelService) private readonly travelService: TravelService,
    @Inject(BuyAutomationService) private readonly buyAutomation: BuyAutomationService,
  ) {}

  @Post()
  buy(@Body() body: unknown): { queued: true; position: number } {
    const parsed = buySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
      );
    }
    if (!this.gate.canControl()) {
      throw new ForbiddenException('macOS control permission required to buy');
    }
    // Mark buy-on-arrival BEFORE enqueuing, so the travel-success handler sees it.
    this.buyAutomation.requestManualBuy(parsed.data.listingId);
    const { position } = this.travelService.enqueue({
      hideoutToken: parsed.data.token,
      search: {
        realm: parsed.data.realm,
        league: parsed.data.league,
        searchId: parsed.data.searchId,
      },
      listingId: parsed.data.listingId,
      itemName: parsed.data.itemName ?? null,
      source: 'manual',
    });
    return { queued: true, position };
  }
}
