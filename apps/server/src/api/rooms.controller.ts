import { Body, Controller, Delete, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { SearchesView } from '@poe-sniper/shared';
import { SearchManager } from '../search/search-manager.js';
import { parseOrBadRequest } from './request-validation.js';

const createRoomSchema = z.object({ name: z.string().trim().min(1).max(60) });

const updateRoomSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    collapsed: z.boolean().optional(),
  })
  .refine((body) => body.name !== undefined || body.collapsed !== undefined, {
    message: 'nothing to update',
  });

/**
 * The operator's D-room-2 choice — REQUIRED, no default: `release` drops the
 * members to the top level in place, `delete-searches` removes them with the room.
 */
const deleteRoomQuerySchema = z.object({ mode: z.enum(['release', 'delete-searches']) });

const setRoomEnabledSchema = z.object({ enabled: z.boolean() });

/** Rooms: named groups of searches on the Searches view (#33). */
@Controller()
export class RoomsController {
  constructor(@Inject(SearchManager) private readonly searchManager: SearchManager) {}

  @Post('rooms')
  create(@Body() body: unknown): SearchesView {
    const { name } = parseOrBadRequest(createRoomSchema, body);
    return this.searchManager.createRoom(name);
  }

  @Patch('rooms/:id')
  update(@Param('id') roomId: string, @Body() body: unknown): SearchesView {
    const payload = parseOrBadRequest(updateRoomSchema, body);
    return this.searchManager.updateRoom(roomId, payload);
  }

  /** Master switch (D-room-1): sets `enabled` on every member search at once. */
  @Post('rooms/:id/enabled')
  setEnabled(@Param('id') roomId: string, @Body() body: unknown): SearchesView {
    const { enabled } = parseOrBadRequest(setRoomEnabledSchema, body);
    return this.searchManager.setRoomEnabled(roomId, enabled);
  }

  @Delete('rooms/:id')
  remove(@Param('id') roomId: string, @Query() query: Record<string, string>): SearchesView {
    const { mode } = parseOrBadRequest(deleteRoomQuerySchema, query);
    return this.searchManager.deleteRoom(roomId, mode);
  }
}
