import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { and, desc, eq, gte, like, lte, or, sql } from 'drizzle-orm';
import type {
  ActivityOutcome,
  ActivityRecord,
  BuyAutomationEvent,
  DomainEvent,
  ItemDetail,
  ListingPrice,
  TravelEvent,
} from '@poe-sniper/shared';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DATABASE } from '../db/db.module.js';
import type { SniperDatabase } from '../db/migrate.js';
import { activity, hits } from '../db/schema.js';
import { errorMessage } from '../util/error-message.js';
import { RealtimeBus } from '../events/realtime-bus.js';

/** Prune cadence — amortizes the DELETE over many buys (mirrors the hits prune). */
const PRUNE_EVERY_N_FINISHED = 50;

export interface ActivityQuery {
  search: string | null;
  outcome: string | null;
  from: string | null;
  to: string | null;
  limit: number;
  offset: number;
}

/**
 * Assembles the operator "Activity" timeline from the realtime bus: one record per
 * travel→buy→return sequence (correlated by listingId — the BuySessionLock guarantees
 * one buy at a time, so a listingId is unambiguous). Snapshots the item from the
 * `hits` table at travel time and persists each record to the `activity` table,
 * upserting on every step. Never stores the session/hideout token (hard rule #3).
 */
@Injectable()
export class ActivityService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ActivityService.name);
  private unsubscribe: (() => void) | null = null;
  /** The in-progress record per listingId. */
  private readonly openByListing = new Map<string, ActivityRecord>();

  /** Terminal records persisted since the last prune (see `pruneActivity`). */
  private finishedSincePrune = 0;

  constructor(
    @Inject(DATABASE) private readonly database: SniperDatabase,
    @Inject(RealtimeBus) private readonly bus: RealtimeBus,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    this.unsubscribe = this.bus.subscribe((event) => this.handle(event));
    this.pruneActivity();
  }

  onApplicationShutdown(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private handle(event: DomainEvent): void {
    try {
      if (event.type === 'travel') this.onTravel(event);
      else if (event.type === 'buy') this.onBuy(event);
    } catch (error) {
      this.logger.warn(`activity record failed: ${errorMessage(error)}`);
    }
  }

  private onTravel(event: TravelEvent): void {
    if (!event.listingId) return;
    const open = this.openByListing.get(event.listingId);
    // Open a new record on the first travel event for this listing (queued/started).
    if (!open && (event.phase === 'queued' || event.phase === 'started')) {
      const snapshot = this.snapshotItem(event.searchId, event.listingId, event.itemName);
      const record: ActivityRecord = {
        id: randomUUID(),
        searchId: event.searchId,
        listingId: event.listingId,
        source: event.source,
        ...snapshot,
        startedAt: event.at,
        finishedAt: null,
        outcome: 'in-progress',
        returnedHome: null,
        steps: [
          {
            kind: 'travel',
            phase: event.phase,
            at: event.at,
            detail: event.detail,
            reason: event.reason,
          },
        ],
      };
      this.openByListing.set(event.listingId, record);
      this.persist(record);
      return;
    }
    if (!open) return;
    open.steps.push({
      kind: 'travel',
      phase: event.phase,
      at: event.at,
      detail: event.detail,
      reason: event.reason,
    });
    if (event.phase === 'failed') {
      open.outcome = 'travel-failed';
      open.finishedAt = event.at;
      this.openByListing.delete(event.listingId);
    }
    this.persist(open);
  }

  private onBuy(event: BuyAutomationEvent): void {
    if (!event.listingId) return;
    const open = this.openByListing.get(event.listingId);
    if (!open) return;
    const isReturn =
      event.phase === 'returning' || event.phase === 'returned' || event.phase === 'return-failed';
    open.steps.push({
      kind: isReturn ? 'return' : 'buy',
      phase: event.phase,
      at: event.at,
      detail: event.detail,
    });

    // Headline outcome = the BUY result (the return is tracked by returnedHome).
    if (event.phase === 'moved') open.outcome = 'placed';
    else if (event.phase === 'aborted') open.outcome = 'aborted';
    else if (event.phase === 'unsupported') open.outcome = 'unsupported';
    else if (event.phase === 'failed') {
      open.outcome =
        event.detail === 'item-sold'
          ? 'item-sold'
          : event.detail === 'trade-window-not-found'
            ? 'no-shop'
            : 'failed';
    }
    if (event.phase === 'returned') open.returnedHome = true;
    if (event.phase === 'return-failed') open.returnedHome = false;

    // Finalize on a definitive terminal. item-sold / no-shop are NOT terminal here —
    // the return-to-hideout still runs and emits returning/returned afterwards.
    const failedNoReturn =
      event.phase === 'failed' &&
      event.detail !== 'item-sold' &&
      event.detail !== 'trade-window-not-found';
    const terminal =
      event.phase === 'returned' ||
      event.phase === 'return-failed' ||
      event.phase === 'aborted' ||
      event.phase === 'unsupported' ||
      failedNoReturn;
    if (terminal) {
      open.finishedAt = event.at;
      this.openByListing.delete(event.listingId);
    }
    this.persist(open);
  }

  /** Latest hit for this listing → the item snapshot (name/price/seller/detail). */
  private snapshotItem(
    searchId: string | null,
    listingId: string,
    fallbackName: string | null,
  ): Pick<ActivityRecord, 'itemName' | 'price' | 'seller' | 'item'> {
    const conditions = [eq(hits.listingId, listingId)];
    if (searchId) conditions.push(eq(hits.searchId, searchId));
    const row = this.database
      .select()
      .from(hits)
      .where(and(...conditions))
      .orderBy(desc(hits.id))
      .limit(1)
      .get();
    return {
      itemName: row?.itemName ?? fallbackName ?? '(unknown)',
      price: (row?.price ?? null) as ListingPrice | null,
      seller: row?.seller ?? null,
      item: (row?.item ?? null) as ItemDetail | null,
    };
  }

  private persist(record: ActivityRecord): void {
    this.database
      .insert(activity)
      .values(record)
      .onConflictDoUpdate({
        target: activity.id,
        set: {
          steps: record.steps,
          outcome: record.outcome,
          finishedAt: record.finishedAt,
          returnedHome: record.returnedHome,
        },
      })
      .run();
    // Only a finished sequence adds a row that will never be upserted again —
    // in-progress steps just rewrite the same row, so they can't grow the table.
    if (record.finishedAt !== null && ++this.finishedSincePrune >= PRUNE_EVERY_N_FINISHED) {
      this.pruneActivity();
    }
  }

  /**
   * Bounded growth (architecture.md invariant): keep only the newest
   * ACTIVITY_MAX_ROWS sequences. Ordered by `started_at` — unlike `hits`, the id
   * here is a uuid and carries no time order — with `rowid` breaking ties so the
   * "newest N" set is deterministic when two records share a timestamp.
   */
  private pruneActivity(): void {
    this.finishedSincePrune = 0;
    this.database.run(sql`
      DELETE FROM activity WHERE rowid NOT IN (
        SELECT rowid FROM activity
        ORDER BY started_at DESC, rowid DESC
        LIMIT ${this.config.ACTIVITY_MAX_ROWS}
      )
    `);
  }

  listActivity(query: ActivityQuery): ActivityRecord[] {
    const conditions = [];
    if (query.search) {
      const needle = `%${query.search}%`;
      conditions.push(or(like(activity.itemName, needle), like(activity.seller, needle)));
    }
    if (query.outcome) conditions.push(eq(activity.outcome, query.outcome as ActivityOutcome));
    if (query.from) conditions.push(gte(activity.startedAt, query.from));
    if (query.to) conditions.push(lte(activity.startedAt, query.to));
    const rows = this.database
      .select()
      .from(activity)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(activity.startedAt))
      .limit(query.limit)
      .offset(query.offset)
      .all();
    return rows as unknown as ActivityRecord[];
  }
}
