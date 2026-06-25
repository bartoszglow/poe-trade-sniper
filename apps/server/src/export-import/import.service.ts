import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PURCHASE_MODES, SEARCH_EXPORT_VERSION } from '@poe-sniper/shared';
import type { ImportConflictMode, ImportResult, ManagedSearch } from '@poe-sniper/shared';
import { SearchManager } from '../search/search-manager.js';

/**
 * One exported search entry, validated to the documented contract — NOT a loose
 * passthrough: `realm`/`purchaseMode` are closed enums and `filters` must be an object,
 * so a hand-edited or cross-version file can't persist an off-contract value that later
 * corrupts the live query. `.strict()` also rejects extra keys, so no credential can be
 * smuggled in (a search carries none anyway).
 */
const searchEntrySchema = z
  .object({
    id: z.string().min(1),
    realm: z.literal('poe2'),
    league: z.string().min(1),
    label: z.string().min(1).max(120),
    autoTravel: z.boolean(),
    autoBuy: z.boolean(),
    enabled: z.boolean(),
    purchaseMode: z.enum(PURCHASE_MODES as [string, ...string[]]).nullable(),
    filters: z.record(z.string(), z.unknown()),
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
    // Reject a NEWER export than this app understands (older/equal is safe to read).
    if (parsed.data.version > SEARCH_EXPORT_VERSION) {
      throw new BadRequestException(
        `unsupported export version ${parsed.data.version} (this app reads up to ${SEARCH_EXPORT_VERSION})`,
      );
    }
    return this.searchManager.importSearches(
      parsed.data.searches as unknown as ManagedSearch[],
      mode,
    );
  }
}
