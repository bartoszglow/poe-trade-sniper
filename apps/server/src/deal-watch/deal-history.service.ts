import { Inject, Injectable, Logger } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import type { DealBaseline, DealBaselineHistoryEntry } from '@poe-sniper/shared';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DATABASE } from '../db/db.module.js';
import type { SniperDatabase } from '../db/migrate.js';
import { dealBaselineHistory } from '../db/schema.js';

/**
 * Baseline price history per deal watch (plan 41, D-dw-12): one row per
 * successful refresh, keyed by the watch's stable uuid (the search's GGG id
 * churns on re-derive). Powers the trend view and the Activity re-derive
 * entries. Writes are BEST-EFFORT — a history failure must never break the
 * refresh that already spent GGG budget (the price-check-history posture).
 */
@Injectable()
export class DealHistoryService {
  private readonly logger = new Logger(DealHistoryService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly database: SniperDatabase,
  ) {}

  record(watchId: string, baseline: DealBaseline, rederived: boolean): void {
    try {
      this.database
        .insert(dealBaselineHistory)
        .values({
          watchId,
          amountExalted: baseline.amountExalted,
          rawLowestExalted: baseline.rawLowestExalted,
          sampleSize: baseline.sampleSize,
          rederived,
          computedAt: baseline.computedAt,
        })
        .run();
      this.pruneForWatch(watchId);
    } catch (error) {
      this.logger.warn(`baseline history write failed for watch ${watchId}: ${String(error)}`);
    }
  }

  /** Newest-first history for the trend view; capped by the retention config. */
  recent(watchId: string, limit: number): DealBaselineHistoryEntry[] {
    const rows = this.database
      .select()
      .from(dealBaselineHistory)
      .where(eq(dealBaselineHistory.watchId, watchId))
      .orderBy(desc(dealBaselineHistory.id))
      .limit(Math.min(limit, this.config.DEAL_BASELINE_HISTORY_MAX))
      .all();
    return rows.map((row) => ({
      amountExalted: row.amountExalted,
      rawLowestExalted: row.rawLowestExalted,
      sampleSize: row.sampleSize,
      rederived: row.rederived,
      computedAt: row.computedAt,
    }));
  }

  /** History dies with the watch (disable / search removal). */
  clearForWatch(watchId: string): void {
    try {
      this.database
        .delete(dealBaselineHistory)
        .where(eq(dealBaselineHistory.watchId, watchId))
        .run();
    } catch (error) {
      this.logger.warn(`baseline history clear failed for watch ${watchId}: ${String(error)}`);
    }
  }

  /** Keep only the newest DEAL_BASELINE_HISTORY_MAX rows of THIS watch. */
  private pruneForWatch(watchId: string): void {
    this.database.run(sql`
      DELETE FROM deal_baseline_history
      WHERE watch_id = ${watchId} AND id <= (
        SELECT id FROM deal_baseline_history
        WHERE watch_id = ${watchId}
        ORDER BY id DESC
        LIMIT 1 OFFSET ${this.config.DEAL_BASELINE_HISTORY_MAX}
      )
    `);
  }
}
