import { BadRequestException, Body, Controller, Inject, Post } from '@nestjs/common';
import { z } from 'zod';
import { TravelService } from './travel.service.js';

/**
 * Manual travel. Tokens are short-lived and never persisted, so the UI sends
 * the token from a live hit event; realm/league/searchId locate the Referer.
 */
const travelSchema = z.object({
  token: z.string().min(20),
  realm: z.string().min(1),
  league: z.string().min(1),
  searchId: z.string().min(1),
  listingId: z.string().min(1).optional(),
  itemName: z.string().min(1).optional(),
});

/**
 * Travel RETRY for an aged hit — NO token in the body (the stored one is expired). The
 * server re-resolves a fresh token by re-fetching / re-searching this offer.
 */
const retrySchema = z.object({
  searchId: z.string().min(1),
  listingId: z.string().min(1),
  offerKey: z.string().min(1),
});

@Controller('travel')
export class TravelController {
  constructor(@Inject(TravelService) private readonly travelService: TravelService) {}

  @Post()
  travel(@Body() body: unknown): { queued: true; position: number } {
    const parsed = travelSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
      );
    }
    const { position } = this.travelService.enqueue({
      hideoutToken: parsed.data.token,
      search: {
        realm: parsed.data.realm,
        league: parsed.data.league,
        searchId: parsed.data.searchId,
      },
      listingId: parsed.data.listingId ?? null,
      itemName: parsed.data.itemName ?? null,
      source: 'manual',
    });
    return { queued: true, position };
  }

  @Post('retry')
  async retry(@Body() body: unknown): Promise<{ found: boolean }> {
    const parsed = retrySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
      );
    }
    return this.travelService.retryTravel(
      parsed.data.searchId,
      parsed.data.listingId,
      parsed.data.offerKey,
    );
  }
}
