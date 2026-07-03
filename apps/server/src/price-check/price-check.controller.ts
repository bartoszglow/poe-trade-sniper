import { Body, Controller, Delete, Get, Inject, Post } from '@nestjs/common';
import { z } from 'zod';
import type { PriceCheckDraft, PriceCheckHistoryEntry, PriceCheckResult } from '@poe-sniper/shared';
import { parseOrBadRequest } from '../api/request-validation.js';
import { PriceCheckHistoryService } from './price-check-history.service.js';
import { PriceCheckService } from './price-check.service.js';

const priceCheckSchema = z.object({
  /** Raw Ctrl+C item text from the game (or pasted in the web dev surface). */
  itemText: z.string().min(1).max(20_000),
});

const parseSchema = z.object({
  itemText: z.string().min(1).max(20_000),
  league: z.string().max(100).optional(),
});

/** The edited draft the operator sends back to price (#38 A). Bounded — the
 *  server rebuilds the query from these fields, so caps keep it well-behaved. */
const statFilterSchema = z.object({
  id: z.string().max(200),
  kind: z.literal('stat'),
  statId: z.string().max(200),
  text: z.string().max(500),
  statType: z.string().max(50),
  enabled: z.boolean(),
  rolls: z.array(z.number()).max(20),
  min: z.number().nullable(),
  max: z.number().nullable(),
  tier: z.object({ tier: z.number(), min: z.number(), max: z.number() }).nullable().optional(),
});

const attrFilterSchema = z.object({
  id: z.string().max(200),
  kind: z.literal('attr'),
  attr: z.string().max(50),
  label: z.string().max(100),
  enabled: z.boolean(),
  inputType: z.enum(['number-min', 'bool', 'option', 'text']),
  value: z.union([z.string().max(200), z.number(), z.boolean(), z.null()]),
  options: z.array(z.object({ value: z.string().max(200), label: z.string().max(200) })).optional(),
});

const draftSchema = z.object({
  item: z.object({
    name: z.string().max(200).nullable(),
    baseType: z.string().max(200).nullable(),
    itemClass: z.string().max(200).nullable(),
    rarity: z.string().max(50).nullable(),
  }),
  league: z.string().min(1).max(100),
  filters: z.array(z.discriminatedUnion('kind', [statFilterSchema, attrFilterSchema])).max(300),
  unmatched: z.array(z.string().max(500)).max(300),
  fixedValue: z.boolean(),
});

@Controller()
export class PriceCheckController {
  constructor(
    @Inject(PriceCheckService) private readonly priceCheck: PriceCheckService,
    @Inject(PriceCheckHistoryService) private readonly history: PriceCheckHistoryService,
  ) {}

  /** One-shot price with defaults (hotkey/overlay/paste), persisted to history. */
  @Post('price-check')
  async check(@Body() body: unknown): Promise<PriceCheckResult> {
    const { itemText } = parseOrBadRequest(priceCheckSchema, body);
    const result = await this.priceCheck.check(itemText);
    this.history.record(result);
    return result;
  }

  /** Parse to an editable draft — no GGG query, no budget cost (#38 A). */
  @Post('price-check/parse')
  async parse(@Body() body: unknown): Promise<PriceCheckDraft> {
    const { itemText, league } = parseOrBadRequest(parseSchema, body);
    return this.priceCheck.parse(itemText, league);
  }

  /** Price the operator's edited draft, persisted to history (#38 A). */
  @Post('price-check/price')
  async price(@Body() body: unknown): Promise<PriceCheckResult> {
    const { draft } = parseOrBadRequest(z.object({ draft: draftSchema }), body);
    const result = await this.priceCheck.priceFromDraft(draft);
    this.history.record(result);
    return result;
  }

  @Get('price-check/history')
  historyList(): PriceCheckHistoryEntry[] {
    return this.history.recent();
  }

  @Delete('price-check/history')
  clearHistory(): void {
    this.history.clear();
  }
}
