import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { PURCHASE_MODES, type Hit, type SearchRuntimeInfo } from '@poe-sniper/shared';
import { SearchManager } from '../search/search-manager.js';

const purchaseModeSchema = z.enum(PURCHASE_MODES as [string, ...string[]]);

const addSearchSchema = z.object({
  /** Bare search id or any trade2 URL (page or websocket). */
  input: z.string().min(1),
  label: z.string().min(1).max(80).optional(),
  league: z.string().min(1).optional(),
  autoTravel: z.boolean().optional(),
  purchaseMode: purchaseModeSchema.nullable().optional(),
});

const updateSearchSchema = z
  .object({
    label: z.string().min(1).max(80).optional(),
    autoTravel: z.boolean().optional(),
    purchaseMode: purchaseModeSchema.nullable().optional(),
  })
  .refine(
    (body) =>
      body.label !== undefined || body.autoTravel !== undefined || body.purchaseMode !== undefined,
    { message: 'nothing to update' },
  );

const listHitsSchema = z.object({
  searchId: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

function parseOrBadRequest<Schema extends z.ZodType>(
  schema: Schema,
  body: unknown,
): z.infer<Schema> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException(
      parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
    );
  }
  return parsed.data;
}

@Controller()
export class SearchesController {
  constructor(@Inject(SearchManager) private readonly searchManager: SearchManager) {}

  @Get('searches')
  list(): SearchRuntimeInfo[] {
    return this.searchManager.list();
  }

  @Post('searches')
  async add(@Body() body: unknown): Promise<SearchRuntimeInfo> {
    const payload = parseOrBadRequest(addSearchSchema, body);
    return this.searchManager.add(payload.input, {
      label: payload.label,
      league: payload.league,
      autoTravel: payload.autoTravel,
      purchaseMode: (payload.purchaseMode ?? null) as SearchRuntimeInfo['purchaseMode'],
    });
  }

  @Patch('searches/:id')
  update(@Param('id') searchId: string, @Body() body: unknown): SearchRuntimeInfo {
    const payload = parseOrBadRequest(updateSearchSchema, body);
    return this.searchManager.update(searchId, {
      label: payload.label,
      autoTravel: payload.autoTravel,
      purchaseMode: payload.purchaseMode as SearchRuntimeInfo['purchaseMode'],
    });
  }

  @Delete('searches/:id')
  remove(@Param('id') searchId: string): { removed: true } {
    this.searchManager.remove(searchId);
    return { removed: true };
  }

  @Get('hits')
  hits(@Query() query: Record<string, string>): Hit[] {
    const payload = parseOrBadRequest(listHitsSchema, query);
    return this.searchManager.listHits(payload.searchId ?? null, payload.limit);
  }
}
