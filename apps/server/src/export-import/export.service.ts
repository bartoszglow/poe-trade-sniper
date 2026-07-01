import { Inject, Injectable } from '@nestjs/common';
import { desc } from 'drizzle-orm';
import {
  SEARCH_EXPORT_VERSION,
  type ItemDetail,
  type ListingPrice,
  type SearchExportEnvelope,
} from '@poe-sniper/shared';
import { DATABASE } from '../db/db.module.js';
import type { SniperDatabase } from '../db/migrate.js';
import { activity, hits } from '../db/schema.js';
import { SearchManager } from '../search/search-manager.js';
import { toCsv } from './csv.js';

const HIT_COLUMNS = [
  'id',
  'searchId',
  'listingId',
  'itemName',
  'price',
  'seller',
  'rarity',
  'itemLevel',
  'corrupted',
  'mods',
  'detectedAt',
] as const;

const ACTIVITY_COLUMNS = [
  'id',
  'searchId',
  'listingId',
  'source',
  'itemName',
  'price',
  'seller',
  'outcome',
  'returnedHome',
  'steps',
  'startedAt',
  'finishedAt',
] as const;

function priceText(price: ListingPrice | null): string {
  return price ? `${price.amount} ${price.currency}` : '';
}

function modsText(item: ItemDetail | null): string {
  if (!item) return '';
  return [...item.implicitMods, ...item.explicitMods, ...item.runeMods, ...item.craftedMods].join(
    ' | ',
  );
}

/**
 * Serializes the exportable tables. Searches → a JSON envelope (round-trippable). Hits +
 * activity → flat CSV (Excel-friendly, export-only). Reads ONLY credential-free tables —
 * never `app_state` (the encrypted session lives there). Hard rule #3.
 */
@Injectable()
export class ExportService {
  constructor(
    @Inject(DATABASE) private readonly database: SniperDatabase,
    @Inject(SearchManager) private readonly searchManager: SearchManager,
  ) {}

  exportSearchesEnvelope(): SearchExportEnvelope {
    return {
      kind: 'poe-sniper-searches',
      version: SEARCH_EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      searches: this.searchManager.exportSearches(),
      rooms: this.searchManager.exportRooms(),
    };
  }

  exportHitsCsv(): string {
    const rows = this.database.select().from(hits).orderBy(desc(hits.id)).all();
    return toCsv(
      rows.map((row) => {
        const item = row.item as ItemDetail | null;
        return {
          id: row.id,
          searchId: row.searchId,
          listingId: row.listingId,
          itemName: row.itemName,
          price: priceText(row.price as ListingPrice | null),
          seller: row.seller ?? '',
          rarity: item?.rarity ?? '',
          itemLevel: item?.itemLevel ?? '',
          corrupted: item?.corrupted ? 'yes' : '',
          mods: modsText(item),
          detectedAt: row.detectedAt,
        };
      }),
      HIT_COLUMNS,
    );
  }

  exportActivityCsv(): string {
    const rows = this.database.select().from(activity).orderBy(desc(activity.startedAt)).all();
    return toCsv(
      rows.map((row) => ({
        id: row.id,
        searchId: row.searchId ?? '',
        listingId: row.listingId ?? '',
        source: row.source,
        itemName: row.itemName,
        price: priceText(row.price as ListingPrice | null),
        seller: row.seller ?? '',
        outcome: row.outcome,
        returnedHome: row.returnedHome == null ? '' : row.returnedHome ? 'yes' : 'no',
        steps: Array.isArray(row.steps) ? row.steps.length : 0,
        startedAt: row.startedAt,
        finishedAt: row.finishedAt ?? '',
      })),
      ACTIVITY_COLUMNS,
    );
  }
}
