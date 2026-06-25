import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { and, desc, eq, gte, like, lte, or } from 'drizzle-orm';
import type {
  ActivityOutcome,
  ActivityRecord,
  BuyAutomationEvent,
  DomainEvent,
  ItemDetail,
  ListingPrice,
  TravelEvent,
} from '@poe-sniper/shared';
import { DATABASE } from '../db/db.module.js';
import type { SniperDatabase } from '../db/migrate.js';
import { activity, hits } from '../db/schema.js';
import { errorMessage } from '../util/error-message.js';
import { RealtimeBus } from '../events/realtime-bus.js';

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

  constructor(
    @Inject(DATABASE) private readonly database: SniperDatabase,
    @Inject(RealtimeBus) private readonly bus: RealtimeBus,
  ) {}

  onApplicationBootstrap(): void {
    this.unsubscribe = this.bus.subscribe((event) => this.handle(event));
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
        steps: [{ kind: 'travel', phase: event.phase, at: event.at, detail: event.detail }],
      };
      this.openByListing.set(event.listingId, record);
      this.persist(record);
      return;
    }
    if (!open) return;
    open.steps.push({ kind: 'travel', phase: event.phase, at: event.at, detail: event.detail });
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
