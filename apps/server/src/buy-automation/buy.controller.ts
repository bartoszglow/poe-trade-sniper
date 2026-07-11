import { Body, Controller, ForbiddenException, Inject, Post } from '@nestjs/common';
import { z } from 'zod';
import { parseOrBadRequest } from '../api/request-validation.js';
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

/**
 * Buy RETRY for an aged hit (the Hits view / an aged live card) — NO token in the
 * body (a persisted hit never carries one; it is stripped at read time). The
 * server re-resolves a fresh token for the offer, then buys on arrival — the same
 * "travel there AND grab" as `buy`, but via the re-resolve path (`retryTravel`).
 */
const buyRetrySchema = z.object({
  searchId: z.string().min(1),
  listingId: z.string().min(1),
  offerKey: z.string().min(1),
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
    const parsed = parseOrBadRequest(buySchema, body);
    if (!this.gate.canControl()) {
      throw new ForbiddenException('macOS control permission required to buy');
    }
    // Mark buy-on-arrival BEFORE enqueuing, so the travel-success handler sees it.
    this.buyAutomation.requestManualBuy(parsed.listingId);
    const { position } = this.travelService.enqueue({
      hideoutToken: parsed.token,
      search: {
        realm: parsed.realm,
        league: parsed.league,
        searchId: parsed.searchId,
      },
      listingId: parsed.listingId,
      itemName: parsed.itemName ?? null,
      source: 'manual',
    });
    return { queued: true, position };
  }

  @Post('retry')
  async buyRetry(@Body() body: unknown): Promise<{ found: boolean }> {
    const { searchId, listingId, offerKey } = parseOrBadRequest(buyRetrySchema, body);
    if (!this.gate.canControl()) {
      throw new ForbiddenException('macOS control permission required to buy');
    }
    // Mark buy-on-arrival BEFORE re-resolving, so the travel-success handler sees
    // it. retryTravel re-tags its travel events with this ORIGINAL listingId, so a
    // successful re-resolved travel matches and the buy fires.
    this.buyAutomation.requestManualBuy(listingId);
    const result = await this.travelService.retryTravel(searchId, listingId, offerKey);
    // If nothing will travel (offer gone or the re-resolve was refused), evict the
    // intent so a later Travel-ONLY on this listing never inherits it (review CORR-1).
    if (!result.found) this.buyAutomation.clearManualBuy(listingId);
    return result;
  }
}
