import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import {
  BASELINE_SAMPLE_SIZE_MAX,
  BASELINE_SAMPLE_SIZE_MIN,
  DEFAULT_BASELINE_SAMPLE_SIZE,
  PURCHASE_MODES,
  type DealBaselineHistoryEntry,
  type Hit,
  type SearchPreview,
  type SearchRuntimeInfo,
  type SearchesView,
} from '@poe-sniper/shared';
import { DealWatchService } from '../deal-watch/deal-watch.service.js';
import { SearchManager } from '../search/search-manager.js';
import { parseOrBadRequest } from './request-validation.js';

const purchaseModeSchema = z.enum(PURCHASE_MODES as [string, ...string[]]);

const addSearchSchema = z.object({
  /** Bare search id or any trade2 URL (page or websocket). */
  input: z.string().min(1),
  label: z.string().min(1).max(80).optional(),
  league: z.string().min(1).optional(),
  autoTravel: z.boolean().optional(),
  autoBuy: z.boolean().optional(),
  purchaseMode: purchaseModeSchema.nullable().optional(),
});

/** Deal-mode config (plan 41): set to enable/edit, null to disable + restore. */
const dealWatchConfigSchema = z.object({
  mode: z.enum(['percent', 'absolute']),
  thresholdValue: z.number().positive(),
  unit: z.enum(['exalted', 'divine']).default('exalted'),
  /** D-dw-15: how many cheapest listings the base price is the median of. */
  baselineSampleSize: z
    .number()
    .int()
    .min(BASELINE_SAMPLE_SIZE_MIN)
    .max(BASELINE_SAMPLE_SIZE_MAX)
    .default(DEFAULT_BASELINE_SAMPLE_SIZE),
});

const updateSearchSchema = z
  .object({
    label: z.string().min(1).max(80).optional(),
    /** Re-point the row at a different trade search (bare id or URL). */
    input: z.string().min(1).max(200).optional(),
    autoTravel: z.boolean().optional(),
    autoBuy: z.boolean().optional(),
    purchaseMode: purchaseModeSchema.nullable().optional(),
    enabled: z.boolean().optional(),
    /** Archive / restore (#35). */
    archived: z.boolean().optional(),
    dealWatch: z.union([dealWatchConfigSchema, z.null()]).optional(),
  })
  .refine(
    (body) =>
      body.label !== undefined ||
      body.input !== undefined ||
      body.autoTravel !== undefined ||
      body.autoBuy !== undefined ||
      body.purchaseMode !== undefined ||
      body.enabled !== undefined ||
      body.archived !== undefined ||
      body.dealWatch !== undefined,
    { message: 'nothing to update' },
  );

const dealHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

const previewSearchSchema = z.object({
  input: z.string().min(1),
  league: z.string().min(1).optional(),
});

/** The reorder payload: the explicit top-level tree (#33) — unambiguous even for empty rooms. */
const layoutEntrySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('search'), id: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal('room'),
      id: z.string().min(1),
      searchIds: z.array(z.string().min(1)).max(2000),
    })
    .strict(),
]);
const reorderSchema = z.object({ layout: z.array(layoutEntrySchema).max(2000) });

const listHitsSchema = z.object({
  searchId: z.string().min(1).optional(),
  search: z.string().min(1).max(120).optional(),
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
  sort: z.enum(['newest', 'oldest', 'name']).default('newest'),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

@Controller()
export class SearchesController {
  constructor(
    @Inject(SearchManager) private readonly searchManager: SearchManager,
    @Inject(DealWatchService) private readonly dealWatch: DealWatchService,
  ) {}

  @Get('searches')
  list(): SearchesView {
    return this.searchManager.view();
  }

  /** Global detection pause state — drives the Searches-view master toggle. */
  @Get('detection')
  detection(): { paused: boolean } {
    return { paused: this.searchManager.isDetectionPaused() };
  }

  @Post('detection')
  setDetection(@Body() body: unknown): { paused: boolean } {
    const { paused } = parseOrBadRequest(z.object({ paused: z.boolean() }), body);
    return { paused: this.searchManager.setDetectionPaused(paused) };
  }

  @Post('searches')
  async add(@Body() body: unknown): Promise<SearchRuntimeInfo> {
    const payload = parseOrBadRequest(addSearchSchema, body);
    return this.searchManager.add(payload.input, {
      label: payload.label,
      league: payload.league,
      autoTravel: payload.autoTravel,
      autoBuy: payload.autoBuy,
      purchaseMode: (payload.purchaseMode ?? null) as SearchRuntimeInfo['purchaseMode'],
    });
  }

  /** Apply a user-defined drag-and-drop layout (#33): top-level order + room membership. */
  @Post('searches/reorder')
  reorder(@Body() body: unknown): SearchesView {
    const { layout } = parseOrBadRequest(reorderSchema, body);
    return this.searchManager.reorder(layout);
  }

  /** Resolve without persisting — powers the add-form criteria preview. */
  @Post('searches/preview')
  async preview(@Body() body: unknown): Promise<SearchPreview> {
    const payload = parseOrBadRequest(previewSearchSchema, body);
    return this.searchManager.preview(payload.input, payload.league);
  }

  @Patch('searches/:id')
  async update(@Param('id') searchId: string, @Body() body: unknown): Promise<SearchRuntimeInfo> {
    const payload = parseOrBadRequest(updateSearchSchema, body);
    // A search-id change re-resolves the new query (async) — keeps history + settings.
    // A combined {input, dealWatch} patch applies BOTH: the re-point first, then
    // the deal config against the NEW id (review F28).
    if (payload.input !== undefined) {
      const edited = await this.searchManager.editSearch(searchId, payload.input, {
        label: payload.label,
      });
      if (payload.dealWatch === undefined) return edited;
      return this.dealWatch.applyConfig(edited.id, payload.dealWatch);
    }
    const hasPlainUpdate =
      payload.label !== undefined ||
      payload.autoTravel !== undefined ||
      payload.autoBuy !== undefined ||
      payload.purchaseMode !== undefined ||
      payload.enabled !== undefined ||
      payload.archived !== undefined;
    let info: SearchRuntimeInfo | null = null;
    if (hasPlainUpdate) {
      info = this.searchManager.update(searchId, {
        label: payload.label,
        autoTravel: payload.autoTravel,
        autoBuy: payload.autoBuy,
        purchaseMode: payload.purchaseMode as SearchRuntimeInfo['purchaseMode'],
        enabled: payload.enabled,
        archived: payload.archived,
      });
    }
    // Deal-mode changes go through the deal-watch orchestrator (plan 41): it
    // owns the enable/edit/disable transforms and their GGG traffic. The deal
    // part runs AFTER the plain update so a combined PATCH sees final flags.
    if (payload.dealWatch !== undefined) {
      info = await this.dealWatch.applyConfig(searchId, payload.dealWatch);
    }
    if (info === null) {
      // Unreachable: the schema refine() rejects an empty patch.
      throw new HttpException('nothing to update', HttpStatus.BAD_REQUEST);
    }
    return info;
  }

  /** Operator-triggered baseline re-check (cooldown-gated, joins a running one). */
  @Post('searches/:id/deal-refresh')
  async dealRefresh(@Param('id') searchId: string): Promise<SearchRuntimeInfo> {
    const result = await this.dealWatch.manualRefresh(searchId);
    if (result.kind === 'cooldown') {
      throw new HttpException(
        { code: 'deal-refresh-cooldown', retryInMs: result.retryInMs },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (result.kind === 'declined') {
      // Archived/disabled/paused/guard-tripped rows cannot refresh — an explicit
      // code, never a silent no-op (review F22).
      throw new HttpException({ code: `deal-refresh-${result.code}` }, HttpStatus.CONFLICT);
    }
    return result.info;
  }

  /** Baseline price history, newest first (plan 41, D-dw-12). */
  @Get('searches/:id/deal-history')
  dealHistory(
    @Param('id') searchId: string,
    @Query() query: Record<string, string>,
  ): DealBaselineHistoryEntry[] {
    const { limit } = parseOrBadRequest(dealHistoryQuerySchema, query);
    return this.dealWatch.history(searchId, limit);
  }

  @Delete('searches/:id')
  remove(@Param('id') searchId: string): { removed: true } {
    this.searchManager.remove(searchId);
    return { removed: true };
  }

  @Get('hits')
  hits(@Query() query: Record<string, string>): Hit[] {
    const payload = parseOrBadRequest(listHitsSchema, query);
    return this.searchManager.listHits({
      searchId: payload.searchId ?? null,
      search: payload.search ?? null,
      from: payload.from ?? null,
      to: payload.to ?? null,
      sort: payload.sort,
      limit: payload.limit,
      offset: payload.offset,
    });
  }
}
