import { Inject, Injectable, Logger } from '@nestjs/common';
import { desc, sql } from 'drizzle-orm';
import type { PriceCheckHistoryEntry, PriceCheckResult } from '@poe-sniper/shared';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DATABASE } from '../db/db.module.js';
import type { SniperDatabase } from '../db/migrate.js';
import { priceCheckHistory } from '../db/schema.js';
import { errorMessage } from '../util/error-message.js';

/**
 * Durable "recent price checks" log (#17). A capped rolling window — recent
 * lookups, not audit history — so the Price Checks view survives a restart.
 * Every check (paste, Settings bench, or a desktop hotkey) lands here via the
 * controller, and the view seeds from it on load.
 */
@Injectable()
export class PriceCheckHistoryService {
  private readonly logger = new Logger(PriceCheckHistoryService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly database: SniperDatabase,
  ) {}

  /**
   * Persist a completed check and prune to the rolling cap. BEST-EFFORT: this is a
   * "recent lookups" log, not audit — a write failure (disk full, IO error) must
   * never throw out of the price-check response path, where the check has already
   * spent load-bearing GGG budget (a 500 here would make the operator retry and
   * double-charge the governor). Returns the new entry, or null if the write failed.
   */
  record(
    result: PriceCheckResult,
    at: string = new Date().toISOString(),
  ): PriceCheckHistoryEntry | null {
    try {
      const inserted = this.database
        .insert(priceCheckHistory)
        .values({ result, checkedAt: at })
        .returning({ id: priceCheckHistory.id })
        .get();
      this.prune();
      return { id: inserted.id, at, result };
    } catch (error) {
      this.logger.warn(`price-check history write failed: ${errorMessage(error)}`);
      return null;
    }
  }

  /** Recent checks, newest first, capped at the history max. */
  recent(): PriceCheckHistoryEntry[] {
    return this.database
      .select()
      .from(priceCheckHistory)
      .orderBy(desc(priceCheckHistory.id))
      .limit(this.config.PRICE_CHECK_HISTORY_MAX)
      .all()
      .map((row) => ({ id: row.id, at: row.checkedAt, result: row.result as PriceCheckResult }));
  }

  clear(): void {
    this.database.delete(priceCheckHistory).run();
  }

  /** Keep only the newest PRICE_CHECK_HISTORY_MAX rows (mirrors hits pruning). */
  private prune(): void {
    this.database.run(sql`
      DELETE FROM price_check_history WHERE id <= (
        SELECT id FROM price_check_history ORDER BY id DESC
        LIMIT 1 OFFSET ${this.config.PRICE_CHECK_HISTORY_MAX}
      )
    `);
  }
}
