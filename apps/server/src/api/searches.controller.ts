import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  PURCHASE_MODES,
  type Hit,
  type SearchPreview,
  type SearchRuntimeInfo,
  type SearchesView,
} from '@poe-sniper/shared';
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

const updateSearchSchema = z
  .object({
    label: z.string().min(1).max(80).optional(),
    /** Re-point the row at a different trade search (bare id or URL). */
    input: z.string().min(1).max(200).optional(),
    autoTravel: z.boolean().optional(),
    autoBuy: z.boolean().optional(),
    purchaseMode: purchaseModeSchema.nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .refine(
    (body) =>
      body.label !== undefined ||
      body.input !== undefined ||
      body.autoTravel !== undefined ||
      body.autoBuy !== undefined ||
      body.purchaseMode !== undefined ||
      body.enabled !== undefined,
    { message: 'nothing to update' },
  );

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
  constructor(@Inject(SearchManager) private readonly searchManager: SearchManager) {}

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
    if (payload.input !== undefined) {
      return this.searchManager.editSearch(searchId, payload.input, { label: payload.label });
    }
    return this.searchManager.update(searchId, {
      label: payload.label,
      autoTravel: payload.autoTravel,
      autoBuy: payload.autoBuy,
      purchaseMode: payload.purchaseMode as SearchRuntimeInfo['purchaseMode'],
      enabled: payload.enabled,
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
