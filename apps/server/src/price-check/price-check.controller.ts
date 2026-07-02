import { Body, Controller, Inject, Post } from '@nestjs/common';
import { z } from 'zod';
import type { PriceCheckResult } from '@poe-sniper/shared';
import { parseOrBadRequest } from '../api/request-validation.js';
import { PriceCheckService } from './price-check.service.js';

const priceCheckSchema = z.object({
  /** Raw Ctrl+C item text from the game (or pasted in the web dev surface). */
  itemText: z.string().min(1).max(20_000),
});

@Controller()
export class PriceCheckController {
  constructor(@Inject(PriceCheckService) private readonly priceCheck: PriceCheckService) {}

  @Post('price-check')
  async check(@Body() body: unknown): Promise<PriceCheckResult> {
    const { itemText } = parseOrBadRequest(priceCheckSchema, body);
    return this.priceCheck.check(itemText);
  }
}
