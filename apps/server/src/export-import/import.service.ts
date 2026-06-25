import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { ImportConflictMode, ImportResult, ManagedSearch } from '@poe-sniper/shared';
import { SearchManager } from '../search/search-manager.js';

/**
 * One exported search entry. `filters` is the opaque resolved trade query (passed through
 * untouched). NO credential fields exist on a search; `.strict()` also rejects any extra
 * keys, so a tampered file can't smuggle one in.
 */
const searchEntrySchema = z
  .object({
    id: z.string().min(1),
    realm: z.string().min(1),
    league: z.string().min(1),
    label: z.string().min(1).max(120),
    autoTravel: z.boolean(),
    autoBuy: z.boolean(),
    enabled: z.boolean(),
    purchaseMode: z.string().nullable(),
    filters: z.unknown(),
    addedAt: z.string().min(1),
  })
  .strict();

const envelopeSchema = z
  .object({
    kind: z.literal('poe-sniper-searches'),
    version: z.number().int(),
    exportedAt: z.string().optional(),
    searches: z.array(searchEntrySchema).max(2000),
  })
  .strict();

/** Validates an uploaded export envelope, then restores it via the SearchManager. */
@Injectable()
export class ImportService {
  constructor(@Inject(SearchManager) private readonly searchManager: SearchManager) {}

  importSearches(body: unknown, mode: ImportConflictMode): ImportResult {
    const parsed = envelopeSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
      );
    }
    return this.searchManager.importSearches(
      parsed.data.searches as unknown as ManagedSearch[],
      mode,
    );
  }
}
