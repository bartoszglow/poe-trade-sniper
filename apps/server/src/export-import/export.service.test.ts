import { describe, expect, it } from 'vitest';
import type { ManagedSearch } from '@poe-sniper/shared';
import { openDatabase } from '../db/migrate.js';
import { activity, hits, searches } from '../db/schema.js';
import type { SearchManager } from '../search/search-manager.js';
import { ExportService } from './export.service.js';

const fixtureSearch: ManagedSearch = {
  id: 's1',
  realm: 'poe2',
  league: 'Standard',
  label: 'My spear',
  autoTravel: true,
  autoBuy: false,
  enabled: true,
  purchaseMode: null,
  filters: { query: { status: { option: 'securable' } } },
  addedAt: '2026-06-25T00:00:00.000Z',
  roomId: 'room-1',
  archivedAt: null,
  dealWatch: null,
};

const fixtureRoom = { id: 'room-1', name: 'Helmets', collapsed: false };

function makeService() {
  const database = openDatabase(':memory:');
  const manager = {
    exportSearches: () => [fixtureSearch],
    exportRooms: () => [fixtureRoom],
  } as unknown as SearchManager;
  return { service: new ExportService(database, manager), database };
}

describe('ExportService', () => {
  it('exports searches as a versioned envelope', () => {
    const { service, database } = makeService();
    try {
      const envelope = service.exportSearchesEnvelope();
      expect(envelope.kind).toBe('poe-sniper-searches');
      expect(envelope.version).toBe(4);
      expect(typeof envelope.exportedAt).toBe('string');
      expect(envelope.searches).toEqual([fixtureSearch]);
      expect(envelope.rooms).toEqual([fixtureRoom]);
    } finally {
      database.$client.close();
    }
  });

  it('never includes credential material', () => {
    const { service, database } = makeService();
    try {
      const json = JSON.stringify(service.exportSearchesEnvelope()).toLowerCase();
      for (const needle of [
        'poesessid',
        'cf_clearance',
        'cookie',
        'useragent',
        'hideouttoken',
        'session',
      ]) {
        expect(json).not.toContain(needle);
      }
    } finally {
      database.$client.close();
    }
  });

  it('exports hits as CSV with a header and escaped cells', () => {
    const { service, database } = makeService();
    try {
      database
        .insert(searches)
        .values({ ...fixtureSearch, filters: fixtureSearch.filters })
        .run();
      database
        .insert(hits)
        .values({
          searchId: 's1',
          listingId: 'l1',
          itemName: 'Spear, Hunting',
          price: { amount: 1, currency: 'regal' },
          seller: 'seller#1',
          item: {
            rarity: 'rare',
            baseType: 'Spear',
            itemLevel: 80,
            corrupted: false,
            properties: [],
            requirements: [],
            implicitMods: [],
            explicitMods: ['+10 Str'],
            runeMods: [],
            craftedMods: [],
          },
          detectedAt: '2026-06-25T00:00:00.000Z',
        })
        .run();
      const lines = service.exportHitsCsv().split('\r\n');
      expect(lines[0]).toContain('listingId');
      expect(lines[1]).toContain('"Spear, Hunting"'); // comma forces quoting
      expect(lines[1]).toContain('1 regal');
      expect(lines[1]).toContain('+10 Str');
    } finally {
      database.$client.close();
    }
  });

  it('exports activity as CSV', () => {
    const { service, database } = makeService();
    try {
      database
        .insert(activity)
        .values({
          id: 'a1',
          searchId: 's1',
          listingId: 'l1',
          source: 'auto',
          itemName: 'Spear',
          price: null,
          seller: 'seller#1',
          item: null,
          startedAt: '2026-06-25T00:00:00.000Z',
          finishedAt: null,
          outcome: 'placed',
          returnedHome: true,
          steps: [{ kind: 'travel', phase: 'queued', at: 'x', detail: null }],
        })
        .run();
      const csv = service.exportActivityCsv();
      expect(csv.split('\r\n')[0]).toContain('outcome');
      expect(csv).toContain('placed');
      expect(csv).toContain('yes'); // returnedHome
    } finally {
      database.$client.close();
    }
  });
});
