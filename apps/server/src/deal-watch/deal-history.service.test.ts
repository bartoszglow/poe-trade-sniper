import { describe, expect, it } from 'vitest';
import type { DealBaseline } from '@poe-sniper/shared';
import { loadConfig } from '../config/env.js';
import { openDatabase } from '../db/migrate.js';
import { DealHistoryService } from './deal-history.service.js';

function baselineAt(amountExalted: number, computedAt: string): DealBaseline {
  return {
    amountExalted,
    sampleSize: 5,
    rawLowestExalted: amountExalted - 10,
    computedAt,
    listingsSeen: 8,
  };
}

function makeService(historyMax = 50) {
  const database = openDatabase(':memory:');
  const config = loadConfig({ DEAL_BASELINE_HISTORY_MAX: String(historyMax) });
  return { service: new DealHistoryService(config, database), database };
}

describe('DealHistoryService', () => {
  it('records and reads back newest-first, scoped per watch', () => {
    const { service, database } = makeService();
    try {
      service.record('w1', baselineAt(100, '2026-07-05T10:00:00.000Z'), false);
      service.record('w1', baselineAt(110, '2026-07-05T11:00:00.000Z'), true);
      service.record('w2', baselineAt(999, '2026-07-05T11:30:00.000Z'), false);

      const entries = service.recent('w1', 10);
      expect(entries).toHaveLength(2);
      expect(entries[0]?.amountExalted).toBe(110);
      expect(entries[0]?.rederived).toBe(true);
      expect(entries[1]?.amountExalted).toBe(100);
      expect(service.recent('w2', 10)).toHaveLength(1);
    } finally {
      database.$client.close();
    }
  });

  it('prunes each watch to the retention cap without touching other watches', () => {
    const { service, database } = makeService(50);
    try {
      for (let sample = 0; sample < 55; sample += 1) {
        service.record(
          'w1',
          baselineAt(sample, `2026-07-05T00:00:${String(sample % 60).padStart(2, '0')}.000Z`),
          false,
        );
      }
      service.record('w2', baselineAt(1, '2026-07-05T12:00:00.000Z'), false);
      expect(service.recent('w1', 500)).toHaveLength(50);
      // The newest survive; the oldest five were pruned.
      expect(service.recent('w1', 500)[0]?.amountExalted).toBe(54);
      expect(service.recent('w2', 500)).toHaveLength(1);
    } finally {
      database.$client.close();
    }
  });

  it('clearForWatch deletes only that watch', () => {
    const { service, database } = makeService();
    try {
      service.record('w1', baselineAt(100, '2026-07-05T10:00:00.000Z'), false);
      service.record('w2', baselineAt(200, '2026-07-05T10:00:00.000Z'), false);
      service.clearForWatch('w1');
      expect(service.recent('w1', 10)).toHaveLength(0);
      expect(service.recent('w2', 10)).toHaveLength(1);
    } finally {
      database.$client.close();
    }
  });

  it('a failed write is swallowed — refreshes must never break on history (best-effort)', () => {
    const { service, database } = makeService();
    database.$client.close();
    expect(() =>
      service.record('w1', baselineAt(100, '2026-07-05T10:00:00.000Z'), false),
    ).not.toThrow();
  });
});
