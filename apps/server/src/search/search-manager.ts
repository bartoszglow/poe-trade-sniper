import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { and, asc, desc, eq, gte, like, lte, or, sql } from 'drizzle-orm';
import type {
  EngineKind,
  EngineStatus,
  Hit,
  Listing,
  ManagedSearch,
  PurchaseMode,
  Realm,
  SearchPreview,
  SearchRuntimeInfo,
} from '@poe-sniper/shared';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { errorMessage } from '../util/error-message.js';
import { OutboundGuard } from '../guard/outbound-guard.js';
import { PermissionGateService } from '../permissions/permission-gate.service.js';
import { DATABASE } from '../db/db.module.js';
import type { SniperDatabase } from '../db/migrate.js';
import { hits, searches } from '../db/schema.js';
import type { DetectionEngine, EngineContext } from '../engines/detection-engine.js';
import { PollEngine } from '../engines/poll-engine.js';
import { RealtimeBus } from '../events/realtime-bus.js';
import { applyPurchaseMode } from '../trade-api/purchase-mode.js';
import {
  NoSessionError,
  TradeApiClient,
  type TradeSearchRef,
} from '../trade-api/trade-api.client.js';
import { ENGINE_REGISTRY, type EngineFactory } from './engine-registry.js';
import { parseSearchInput, queryStatusOption } from './search-input.js';

export interface AddSearchOptions {
  label?: string;
  league?: string;
  autoTravel?: boolean;
  autoBuy?: boolean;
  purchaseMode?: PurchaseMode | null;
}

export interface UpdateSearchOptions {
  label?: string;
  autoTravel?: boolean;
  autoBuy?: boolean;
  purchaseMode?: PurchaseMode | null;
  enabled?: boolean;
}

export type HitSort = 'newest' | 'oldest' | 'name';

/** Filter + page descriptor for the Hits browse view. */
export interface HitQuery {
  searchId: string | null;
  /** Free-text match on item name or seller. */
  search: string | null;
  /** ISO-8601 lower / upper bounds on detection time (inclusive). */
  from: string | null;
  to: string | null;
  sort: HitSort;
  limit: number;
  offset: number;
}

/** Prune cadence — checking on every single hit would be wasted writes. */
const PRUNE_EVERY_HITS = 100;

interface Watcher {
  row: ManagedSearch;
  /**
   * Persistent live-ws engine — one socket per search, like a single browser
   * trade tab. Reconnects forever on its own; null only when torn down
   * (pause / guard / shutdown).
   */
  wsEngine: DetectionEngine | null;
  /**
   * Poll engine that COVERS THE GAP while ws is not connected (and the cold
   * fallback when ws can't reach the backend). Freshly created each gap so it
   * re-baselines and never re-reports listings ws already saw; torn down the
   * moment ws connects.
   */
  pollEngine: DetectionEngine | null;
  /** True while the ws socket is open — gates poll coverage and the display kind. */
  wsConnected: boolean;
  status: EngineStatus;
  statusDetail: string | null;
  correlationId: string;
  hitCount: number;
  lastHitAt: string | null;
  /**
   * Listing ids already emitted for this search — dedup across poll cycles and
   * ws↔poll handoffs (GGG re-serves the same id, especially right after a
   * travel), so each listing shows ONCE in the feed and is stored once. Bounded
   * FIFO (SEEN_IDS_CAP); in-memory, so a server restart may re-show old hits —
   * acceptable for a single-operator local tool.
   */
  seenListingIds: Set<string>;
}

/**
 * Owns the watched-search lifecycle: persistence, engine selection via the
 * registry, the shared round-robin poll scheduler (one search POST per tick
 * across ALL polled searches — the budget is per-IP), hit persistence and
 * domain events.
 */
@Injectable()
export class SearchManager implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SearchManager.name);
  private readonly watchers = new Map<string, Watcher>();
  private schedulerTimer: NodeJS.Timeout | null = null;
  private roundRobinIndex = 0;
  private tickInFlight = false;
  private hitsSincePrune = 0;
  /** Global pause: every enabled search halts as PAUSED until resumed. */
  private detectionPaused = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly database: SniperDatabase,
    @Inject(ENGINE_REGISTRY) private readonly engineRegistry: EngineFactory[],
    @Inject(TradeApiClient) private readonly tradeApi: TradeApiClient,
    @Inject(RealtimeBus) private readonly realtimeBus: RealtimeBus,
    @Inject(OutboundGuard) private readonly guard: OutboundGuard,
    @Inject(PermissionGateService) private readonly gate: PermissionGateService,
  ) {}

  onApplicationBootstrap(): void {
    for (const row of this.database.select().from(searches).all()) {
      this.watchers.set(row.id, this.createWatcher(this.rowToManagedSearch(row)));
    }
    // Restore hit count + last-hit from the hits table in ONE grouped query (not
    // N per-search scans, PERF-6) — without it the UI shows "0 hits" after restart.
    this.hydrateAllHitStats();
    this.pruneHits();
    this.startPendingWatchers();
    this.schedulerTimer = setInterval(() => {
      void this.runSchedulerTick();
    }, this.config.POLL_INTERVAL_MS);
    this.logger.log(
      `watching ${this.watchers.size} search(es); scheduler tick ${this.config.POLL_INTERVAL_MS}ms`,
    );
  }

  onApplicationShutdown(): void {
    if (this.schedulerTimer) clearInterval(this.schedulerTimer);
    this.schedulerTimer = null;
    for (const watcher of this.watchers.values()) {
      this.stopEngines(watcher);
    }
  }

  list(): SearchRuntimeInfo[] {
    return [...this.watchers.values()].map((watcher) => this.toRuntimeInfo(watcher));
  }

  /** Resolve an input to its query WITHOUT persisting — the add-form preview. */
  async preview(input: string, league: string | undefined): Promise<SearchPreview> {
    const ref = this.parseRef(input, league);
    try {
      const query = await this.tradeApi.resolveQuery(ref, randomUUID());
      return { id: ref.searchId, realm: ref.realm as Realm, league: ref.league, query };
    } catch (error) {
      if (error instanceof NoSessionError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  async add(input: string, options: AddSearchOptions): Promise<SearchRuntimeInfo> {
    const ref = this.parseRef(input, options.league);
    if (this.watchers.has(ref.searchId)) {
      throw new ConflictException(`search ${ref.searchId} is already watched`);
    }

    const correlationId = randomUUID();
    let resolvedQuery: unknown;
    try {
      resolvedQuery = await this.tradeApi.resolveQuery(ref, correlationId);
    } catch (error) {
      if (error instanceof NoSessionError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    const purchaseMode = options.purchaseMode ?? null;
    const autoTravel = options.autoTravel ?? false;
    this.assertAutoTravelAllowed(autoTravel, resolvedQuery, purchaseMode);
    const autoBuy = options.autoBuy ?? false;
    this.assertAutoBuyAllowed(autoBuy);

    const row: ManagedSearch = {
      id: ref.searchId,
      realm: ref.realm as Realm,
      league: ref.league,
      label: options.label ?? ref.searchId,
      autoTravel,
      autoBuy,
      enabled: true,
      purchaseMode,
      filters: resolvedQuery,
      addedAt: new Date().toISOString(),
    };
    this.database
      .insert(searches)
      .values({ ...row, filters: resolvedQuery })
      .run();

    const watcher = this.createWatcher(row);
    watcher.correlationId = correlationId;
    this.watchers.set(row.id, watcher);
    if (this.detectionPaused) {
      this.publishEngineStatus(watcher, 'paused', 'globally paused');
    } else {
      this.startWatcher(watcher);
    }
    this.publishSearchesChanged();
    return this.toRuntimeInfo(watcher);
  }

  update(searchId: string, options: UpdateSearchOptions): SearchRuntimeInfo {
    const watcher = this.requireWatcher(searchId);
    const purchaseMode =
      options.purchaseMode !== undefined ? options.purchaseMode : watcher.row.purchaseMode;
    const autoTravel = options.autoTravel ?? watcher.row.autoTravel;
    this.assertAutoTravelAllowed(autoTravel, watcher.row.filters, purchaseMode);
    const autoBuy = options.autoBuy ?? watcher.row.autoBuy;
    // Only gate when Buy is being turned ON in THIS request — an unrelated patch
    // (rename, pause, purchase-mode) on a search with a persisted autoBuy must NOT
    // be blocked by a later permission revocation (decision #2=B: the intent is
    // preserved and restored on re-grant; the runtime gate is the real enforcement).
    if (options.autoBuy === true) this.assertAutoBuyAllowed(true);
    const wasEnabled = watcher.row.enabled;
    const enabled = options.enabled ?? wasEnabled;

    watcher.row = {
      ...watcher.row,
      label: options.label ?? watcher.row.label,
      autoTravel,
      autoBuy,
      purchaseMode,
      enabled,
    };
    this.database
      .update(searches)
      .set({
        label: watcher.row.label,
        autoTravel: watcher.row.autoTravel,
        autoBuy: watcher.row.autoBuy,
        purchaseMode: watcher.row.purchaseMode,
        enabled: watcher.row.enabled,
      })
      .where(eq(searches.id, searchId))
      .run();

    if (!enabled && wasEnabled) {
      // Per-search disable: stop detection but keep the search and its config.
      this.stopEngines(watcher);
      this.publishEngineStatus(watcher, 'stopped', 'paused');
    } else if (enabled && !wasEnabled) {
      // Re-enabled — start now, unless detection is globally paused (then it
      // waits as PAUSED and comes up on the next global resume).
      if (this.detectionPaused) {
        this.publishEngineStatus(watcher, 'paused', 'globally paused');
      } else {
        this.startWatcher(watcher);
      }
    } else if (options.purchaseMode !== undefined && enabled && !this.detectionPaused) {
      // A purchase-mode change alters the executed query — restart detection.
      this.stopEngines(watcher);
      this.startWatcher(watcher);
    }
    this.publishSearchesChanged();
    return this.toRuntimeInfo(watcher);
  }

  /**
   * Re-point an existing search at a DIFFERENT trade search (the Edit dialog),
   * keeping the row's settings AND its hit history. A label-only edit (the search
   * id is unchanged) is a plain update — no re-resolve, no restart. Changing the
   * search id re-resolves the new query, validates the carried settings against
   * it, then atomically inserts the new row, re-points hits onto it, and drops
   * the old row (FK is ON DELETE CASCADE → re-point BEFORE delete), and swaps the
   * detection watcher onto the new query carrying the live hit counters.
   */
  async editSearch(
    searchId: string,
    input: string,
    options: { label?: string },
  ): Promise<SearchRuntimeInfo> {
    const watcher = this.requireWatcher(searchId);
    const ref = this.parseRef(input, watcher.row.league);
    if (ref.searchId === searchId) {
      // Same trade search — only the label can change here; no GGG call/restart.
      return this.update(searchId, { label: options.label });
    }
    if (this.watchers.has(ref.searchId)) {
      throw new ConflictException(`search ${ref.searchId} is already watched`);
    }
    const correlationId = randomUUID();
    let resolvedQuery: unknown;
    try {
      resolvedQuery = await this.tradeApi.resolveQuery(ref, correlationId);
    } catch (error) {
      if (error instanceof NoSessionError) throw new BadRequestException(error.message);
      throw error;
    }
    // Validate the carried settings against the NEW query BEFORE mutating anything.
    this.assertAutoTravelAllowed(watcher.row.autoTravel, resolvedQuery, watcher.row.purchaseMode);

    const newRow: ManagedSearch = {
      ...watcher.row,
      id: ref.searchId,
      realm: ref.realm as Realm,
      league: ref.league,
      label: options.label ?? watcher.row.label,
      filters: resolvedQuery,
    };
    this.database.transaction((tx) => {
      tx.insert(searches)
        .values({ ...newRow, filters: resolvedQuery })
        .run();
      tx.update(hits).set({ searchId: newRow.id }).where(eq(hits.searchId, searchId)).run();
      tx.delete(searches).where(eq(searches.id, searchId)).run();
    });

    this.stopEngines(watcher);
    this.watchers.delete(searchId);
    const newWatcher = this.createWatcher(newRow);
    newWatcher.correlationId = correlationId;
    newWatcher.hitCount = watcher.hitCount;
    newWatcher.lastHitAt = watcher.lastHitAt;
    this.watchers.set(newRow.id, newWatcher);
    if (this.detectionPaused) {
      this.publishEngineStatus(newWatcher, 'paused', 'globally paused');
    } else if (newRow.enabled) {
      this.startWatcher(newWatcher);
    } else {
      this.publishEngineStatus(newWatcher, 'stopped', 'paused');
    }
    this.publishSearchesChanged();
    return this.toRuntimeInfo(newWatcher);
  }

  remove(searchId: string): void {
    const watcher = this.requireWatcher(searchId);
    this.stopEngines(watcher);
    this.watchers.delete(searchId);
    this.database.delete(searches).where(eq(searches.id, searchId)).run();
    this.publishSearchesChanged();
  }

  listHits(query: HitQuery): Hit[] {
    const conditions = [];
    if (query.searchId) conditions.push(eq(hits.searchId, query.searchId));
    if (query.search) {
      const needle = `%${query.search}%`;
      conditions.push(or(like(hits.itemName, needle), like(hits.seller, needle)));
    }
    // detectedAt is stored ISO-8601, so lexicographic compare is chronological.
    if (query.from) conditions.push(gte(hits.detectedAt, query.from));
    if (query.to) conditions.push(lte(hits.detectedAt, query.to));

    const order =
      query.sort === 'oldest'
        ? asc(hits.id)
        : query.sort === 'name'
          ? asc(hits.itemName)
          : desc(hits.id);

    const rows = this.database
      .select()
      .from(hits)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(order)
      .limit(query.limit)
      .offset(query.offset)
      .all();
    return rows.map((row) => ({
      id: row.id,
      listingId: row.listingId,
      searchId: row.searchId,
      itemName: row.itemName,
      price: row.price as Hit['price'],
      seller: row.seller === '' ? null : row.seller,
      hideoutToken: null, // expired by read time (~300 s TTL) — never persisted
      item: row.item as Hit['item'],
      detectedAt: row.detectedAt,
    }));
  }

  /** Narrow read used by the TravelService's hit-event subscriber. */
  isAutoTravelEnabled(searchId: string): boolean {
    return this.watchers.get(searchId)?.row.autoTravel ?? false;
  }

  /** Narrow read used by the BuyAutomationService's travel-success subscriber. */
  isAutoBuyEnabled(searchId: string): boolean {
    return this.watchers.get(searchId)?.row.autoBuy ?? false;
  }

  getSearchRef(searchId: string): TradeSearchRef | null {
    const watcher = this.watchers.get(searchId);
    return watcher ? this.toRef(watcher.row) : null;
  }

  summary(): { total: number; byStatus: Record<string, number> } {
    const byStatus: Record<string, number> = {};
    for (const watcher of this.watchers.values()) {
      byStatus[watcher.status] = (byStatus[watcher.status] ?? 0) + 1;
    }
    return { total: this.watchers.size, byStatus };
  }

  isDetectionPaused(): boolean {
    return this.detectionPaused;
  }

  /**
   * Global pause/resume. Pausing halts every ENABLED search as PAUSED (distinct
   * from a per-search STOPPED) without clearing its enabled flag; resuming
   * brings them all back. Already-disabled searches are left untouched.
   */
  setDetectionPaused(paused: boolean): boolean {
    if (paused === this.detectionPaused) return this.detectionPaused;
    this.detectionPaused = paused;
    for (const watcher of this.watchers.values()) {
      if (!watcher.row.enabled) continue;
      if (paused) {
        this.stopEngines(watcher);
        this.publishEngineStatus(watcher, 'paused', 'globally paused');
      } else {
        this.startWatcher(watcher);
      }
    }
    this.publishSearchesChanged();
    return this.detectionPaused;
  }

  /** One scheduler tick — exposed for tests; production runs it on a timer. */
  async runSchedulerTick(): Promise<void> {
    if (this.tickInFlight) return;
    this.tickInFlight = true;
    try {
      // Guard tripped → wind everything down and stay idle until reset.
      if (this.guard.tripped) {
        this.windDownForGuard();
        return;
      }
      if (this.detectionPaused) return;
      this.startPendingWatchers();

      // Poll only the watchers whose ws is NOT currently connected — i.e. cover
      // the reconnect gap. When ws is up, the search is served by push and is
      // skipped here (no double traffic; matches a browser tab).
      const pollWatchers = [...this.watchers.values()].filter(
        (watcher) => watcher.row.enabled && watcher.pollEngine !== null && !watcher.wsConnected,
      );
      if (pollWatchers.length === 0) return;
      const watcher = pollWatchers[this.roundRobinIndex % pollWatchers.length]!;
      this.roundRobinIndex = (this.roundRobinIndex + 1) % Math.max(pollWatchers.length, 1);
      try {
        await (watcher.pollEngine as PollEngine).tick();
      } catch (error) {
        this.publishEngineStatus(watcher, 'degraded', errorMessage(error));
      }
    } finally {
      this.tickInFlight = false;
    }
  }

  /** Stops every engine; watchers auto-restart on the next tick post-reset. */
  private windDownForGuard(): void {
    for (const watcher of this.watchers.values()) {
      if (watcher.wsEngine || watcher.pollEngine) {
        this.stopEngines(watcher);
        this.publishEngineStatus(watcher, 'degraded', 'safety guard tripped — detection halted');
      }
    }
  }

  private startPendingWatchers(): void {
    if (this.detectionPaused) return;
    for (const watcher of this.watchers.values()) {
      if (!watcher.row.enabled) continue;
      if (
        watcher.wsEngine === null &&
        watcher.pollEngine === null &&
        watcher.status !== 'stopped'
      ) {
        this.startWatcher(watcher);
      }
    }
  }

  private wsFactory(): EngineFactory | undefined {
    return this.engineRegistry.find((factory) => factory.kind === 'ws');
  }

  private pollFactory(): EngineFactory | undefined {
    return this.engineRegistry.find((factory) => factory.kind === 'poll');
  }

  /**
   * Start a search: bring up the persistent ws engine (one socket, like a
   * browser tab) AND poll coverage for the gap until ws connects. No engine
   * selection / probe — the ws connection attempt is its own test, and poll
   * always covers while ws isn't connected.
   */
  private startWatcher(watcher: Watcher): void {
    const { query, applied } = applyPurchaseMode(watcher.row.filters, watcher.row.purchaseMode);
    if (!applied) {
      this.publishLog(
        'warn',
        `${watcher.row.id}: purchase mode "${watcher.row.purchaseMode}" has no verified API mapping — using the query's own status`,
        watcher.correlationId,
      );
    }
    const context = {
      search: this.toRef(watcher.row),
      query,
      correlationId: watcher.correlationId,
    };

    watcher.wsConnected = false;
    const wsFactory = this.wsFactory();
    if (wsFactory) {
      const ws = wsFactory.create();
      watcher.wsEngine = ws;
      ws.start(context, {
        onListings: (listings) => this.recordHits(watcher, listings),
        onStatus: (status, detail) => this.onWsStatus(watcher, status, detail),
      });
    }
    // Cover the gap until ws connects (and forever if there is no ws factory).
    this.startPollCoverage(watcher, context);
  }

  /** ws connected → drop poll; ws lost/connecting → (re)start fresh poll coverage. */
  private onWsStatus(watcher: Watcher, status: EngineStatus, detail: string | null): void {
    if (status === 'active') {
      watcher.wsConnected = true;
      this.stopPollCoverage(watcher);
      this.publishEngineStatus(watcher, 'active', detail);
      return;
    }
    // connecting / degraded — ws is not serving; poll must cover the gap.
    watcher.wsConnected = false;
    if (!watcher.pollEngine && watcher.row.enabled) {
      const { query } = applyPurchaseMode(watcher.row.filters, watcher.row.purchaseMode);
      this.startPollCoverage(watcher, {
        search: this.toRef(watcher.row),
        query,
        correlationId: watcher.correlationId,
      });
    }
    // While poll covers, the poll engine owns the displayed status; only surface
    // the ws detail when there is no poll coverage at all.
    if (!watcher.pollEngine) {
      this.publishEngineStatus(watcher, status, detail);
    }
  }

  private onPollStatus(watcher: Watcher, status: EngineStatus, detail: string | null): void {
    // ws push wins the display when connected; ignore poll chatter then.
    if (watcher.wsConnected) return;
    this.publishEngineStatus(watcher, status, detail);
  }

  private startPollCoverage(watcher: Watcher, context: EngineContext): void {
    if (watcher.pollEngine || watcher.wsConnected) return;
    const pollFactory = this.pollFactory();
    if (!pollFactory) return;
    const poll = pollFactory.create();
    watcher.pollEngine = poll;
    poll.start(context, {
      onListings: (listings) => this.recordHits(watcher, listings),
      onStatus: (status, detail) => this.onPollStatus(watcher, status, detail),
    });
  }

  private stopPollCoverage(watcher: Watcher): void {
    watcher.pollEngine?.stop();
    watcher.pollEngine = null;
  }

  private stopEngines(watcher: Watcher): void {
    watcher.wsEngine?.stop();
    watcher.wsEngine = null;
    watcher.pollEngine?.stop();
    watcher.pollEngine = null;
    watcher.wsConnected = false;
  }

  private recordHits(watcher: Watcher, listings: Listing[]): void {
    if (listings.length === 0) return;
    // Per-search dedup: GGG re-serves the same listingId across poll cycles and
    // ws↔poll handoffs (especially right after a travel re-queries), which would
    // spam the feed with the same item. Show each listing ONCE. Mark seen BEFORE
    // the write so a throwing insert can't loop forever on the same id.
    const fresh = listings.filter((listing) => !watcher.seenListingIds.has(listing.listingId));
    if (fresh.length === 0) return;
    for (const listing of fresh) watcher.seenListingIds.add(listing.listingId);
    this.evictSeenIds(watcher);
    // One transaction (better-sqlite3 is synchronous) → a single commit/fsync per
    // burst, and no partial DB state if a row throws mid-loop (PERF-4).
    this.database.transaction((tx) => {
      for (const listing of fresh) {
        tx.insert(hits)
          .values({
            searchId: listing.searchId,
            listingId: listing.listingId,
            itemName: listing.itemName,
            price: listing.price,
            seller: listing.seller ?? '',
            item: listing.item,
            detectedAt: listing.detectedAt,
          })
          .run();
      }
    });
    // Bookkeeping + domain events only after the writes commit.
    for (const listing of fresh) {
      watcher.hitCount += 1;
      watcher.lastHitAt = listing.detectedAt;
      this.hitsSincePrune += 1;
      this.realtimeBus.publish({ type: 'hit', listing });
      // autoTravel / autoBuy: the Travel + Buy services consume hit/travel events.
    }
    if (this.hitsSincePrune >= PRUNE_EVERY_HITS) {
      this.hitsSincePrune = 0;
      this.pruneHits();
    }
  }

  /** Bounded FIFO eviction of a search's seen-id set (Set preserves insertion order). */
  private evictSeenIds(watcher: Watcher): void {
    const cap = this.config.SEEN_IDS_CAP;
    if (watcher.seenListingIds.size <= cap) return;
    for (const id of watcher.seenListingIds) {
      if (watcher.seenListingIds.size <= cap) break;
      watcher.seenListingIds.delete(id);
    }
  }

  /** Bounded growth: keep only the newest HITS_MAX_ROWS rows. */
  private pruneHits(): void {
    this.database.run(sql`
      DELETE FROM hits WHERE id <= (
        SELECT id FROM hits ORDER BY id DESC
        LIMIT 1 OFFSET ${this.config.HITS_MAX_ROWS}
      )
    `);
  }

  /** Display engine kind: ws while connected, poll while it covers a gap. */
  private currentEngineKind(watcher: Watcher): EngineKind | null {
    if (watcher.wsConnected) return 'ws';
    if (watcher.pollEngine) return 'poll';
    return null;
  }

  private publishEngineStatus(watcher: Watcher, status: EngineStatus, detail: string | null): void {
    watcher.status = status;
    watcher.statusDetail = detail;
    this.realtimeBus.publish({
      type: 'engine-status',
      searchId: watcher.row.id,
      engine: this.currentEngineKind(watcher) ?? 'poll',
      status,
    });
  }

  private assertAutoTravelAllowed(
    autoTravel: boolean,
    resolvedQuery: unknown,
    purchaseMode: PurchaseMode | null,
  ): void {
    if (!autoTravel) return;
    const { query } = applyPurchaseMode(resolvedQuery, purchaseMode);
    if (queryStatusOption(query) !== 'securable') {
      throw new BadRequestException(
        'auto-travel needs Instant Buyout listings (status "securable") — only they carry a hideout token',
      );
    }
  }

  /**
   * Buy automation is independent of auto-travel (D-19) — only the macOS
   * `control` permission gates it (decision #2 = B). It still triggers only on a
   * travel `success` (auto OR manual), so it acts once the character is at the
   * seller. Rejected at the API boundary so a search can never persist an
   * unsatisfiable intent; the desktop adapters re-check at the resource boundary.
   */
  private assertAutoBuyAllowed(autoBuy: boolean): void {
    if (!autoBuy) return;
    if (!this.gate.canControl()) {
      throw new BadRequestException('grant Screen Recording + Accessibility to enable auto-buy');
    }
  }

  private parseRef(input: string, league: string | undefined): TradeSearchRef {
    try {
      return parseSearchInput(input, league ?? this.config.DEFAULT_LEAGUE);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'invalid input');
    }
  }

  private requireWatcher(searchId: string): Watcher {
    const watcher = this.watchers.get(searchId);
    if (!watcher) throw new NotFoundException(`search ${searchId} is not watched`);
    return watcher;
  }

  /** Restore hitCount + lastHitAt for ALL watchers in one grouped query (PERF-6). */
  private hydrateAllHitStats(): void {
    const rows = this.database
      .select({
        searchId: hits.searchId,
        total: sql<number>`count(*)`,
        last: sql<string | null>`max(${hits.detectedAt})`,
      })
      .from(hits)
      .groupBy(hits.searchId)
      .all();
    for (const stats of rows) {
      const watcher = this.watchers.get(stats.searchId);
      if (!watcher) continue;
      watcher.hitCount = stats.total ?? 0;
      watcher.lastHitAt = stats.last ?? null;
    }
  }

  private createWatcher(row: ManagedSearch): Watcher {
    return {
      row,
      wsEngine: null,
      pollEngine: null,
      wsConnected: false,
      status: row.enabled ? 'pending' : 'stopped',
      statusDetail: row.enabled ? null : 'paused',
      correlationId: randomUUID(),
      hitCount: 0,
      lastHitAt: null,
      seenListingIds: new Set(),
    };
  }

  private rowToManagedSearch(row: typeof searches.$inferSelect): ManagedSearch {
    return {
      id: row.id,
      realm: row.realm as Realm,
      league: row.league,
      label: row.label,
      autoTravel: row.autoTravel,
      autoBuy: row.autoBuy,
      enabled: row.enabled,
      purchaseMode: (row.purchaseMode as PurchaseMode | null) ?? null,
      filters: row.filters,
      addedAt: row.addedAt,
    };
  }

  private toRef(row: ManagedSearch): TradeSearchRef {
    return { realm: row.realm, league: row.league, searchId: row.id };
  }

  private toRuntimeInfo(watcher: Watcher): SearchRuntimeInfo {
    return {
      ...watcher.row,
      engine: this.currentEngineKind(watcher),
      status: watcher.status,
      statusDetail: watcher.statusDetail,
      hitCount: watcher.hitCount,
      lastHitAt: watcher.lastHitAt,
    };
  }

  private publishSearchesChanged(): void {
    this.realtimeBus.publish({
      type: 'searches-changed',
      searches: [...this.watchers.values()].map((watcher) => watcher.row),
    });
  }

  private publishLog(
    level: 'info' | 'warn' | 'error',
    message: string,
    correlationId: string,
  ): void {
    this.logger[level === 'info' ? 'log' : level](message);
    this.realtimeBus.publish({
      type: 'log',
      level,
      message,
      correlationId,
      at: new Date().toISOString(),
    });
  }
}
