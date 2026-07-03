import { beforeEach, describe, expect, it } from 'vitest';
import type { PriceCheckResult } from '@poe-sniper/shared';
import { loadConfig } from '../config/env.js';
import { openDatabase, type SniperDatabase } from '../db/migrate.js';
import { PriceCheckHistoryService } from './price-check-history.service.js';

function makeResult(name: string): PriceCheckResult {
  return {
    kind: 'aggregate',
    item: {
      name,
      baseType: null,
      itemClass: null,
      rarity: null,
      matchedStats: [],
      unmatchedLines: [],
    },
    estimate: { amount: 1, currency: 'exalted' },
    listings: [],
    declineReason: null,
    searchHeadroom: 1,
  };
}

describe('PriceCheckHistoryService', () => {
  let database: SniperDatabase;

  beforeEach(() => {
    // In-memory DB, fully migrated (incl. 0010) — no live GGG, no disk.
    database = openDatabase(':memory:');
  });

  function makeService(historyMax = 10): PriceCheckHistoryService {
    const config = loadConfig({ PRICE_CHECK_HISTORY_MAX: String(historyMax) });
    return new PriceCheckHistoryService(config, database);
  }

  it('records checks and returns them newest-first', () => {
    const service = makeService();
    service.record(makeResult('a'), '2026-07-03T00:00:00.000Z');
    service.record(makeResult('b'), '2026-07-03T00:01:00.000Z');
    const recent = service.recent();
    expect(recent.map((entry) => entry.result.item.name)).toEqual(['b', 'a']);
    expect(recent[0]?.at).toBe('2026-07-03T00:01:00.000Z');
  });

  it('prunes to the rolling cap, keeping the newest', () => {
    const service = makeService(10);
    const names = 'abcdefghijkl'.split(''); // 12 > cap 10
    for (const name of names) service.record(makeResult(name));
    const recent = service.recent();
    expect(recent).toHaveLength(10);
    expect(recent[0]?.result.item.name).toBe('l'); // newest
    expect(recent.at(-1)?.result.item.name).toBe('c'); // oldest surviving (a,b pruned)
  });

  it('clear empties the log', () => {
    const service = makeService();
    service.record(makeResult('a'));
    service.clear();
    expect(service.recent()).toEqual([]);
  });
});
