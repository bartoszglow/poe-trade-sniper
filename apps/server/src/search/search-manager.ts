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
import { desc, eq, sql } from 'drizzle-orm';
import type {
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
import { OutboundGuard } from '../guard/outbound-guard.js';
import { DATABASE } from '../db/db.module.js';
import type { SniperDatabase } from '../db/migrate.js';
import { hits, searches } from '../db/schema.js';
import type { DetectionEngine } from '../engines/detection-engine.js';
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
  purchaseMode?: PurchaseMode | null;
}

export interface UpdateSearchOptions {
  label?: string;
  autoTravel?: boolean;
  purchaseMode?: PurchaseMode | null;
  enabled?: boolean;
}

/** Prune cadence — checking on every single hit would be wasted writes. */
const PRUNE_EVERY_HITS = 100;

interface Watcher {
  row: ManagedSearch;
  engine: DetectionEngine | null;
  status: EngineStatus;
  statusDetail: string | null;
  correlationId: string;
  hitCount: number;
  lastHitAt: string | null;
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
  private wsProbeTimer: NodeJS.Timeout | null = null;
  private roundRobinIndex = 0;
  private tickInFlight = false;
  private wsProbeInFlight = false;
  /**
   * Set by the background live-backend probe, consumed by the next poll tick:
   * promotion happens INSIDE the guarded tick (synchronous) so it never races
   * the poll loop, while the slow probe itself stays off the tick.
   */
  private liveBackendConfirmedUp = false;
  private hitsSincePrune = 0;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly database: SniperDatabase,
    @Inject(ENGINE_REGISTRY) private readonly engineRegistry: EngineFactory[],
    @Inject(TradeApiClient) private readonly tradeApi: TradeApiClient,
    @Inject(RealtimeBus) private readonly realtimeBus: RealtimeBus,
    @Inject(OutboundGuard) private readonly guard: OutboundGuard,
  ) {}

  onApplicationBootstrap(): void {
    for (const row of this.database.select().from(searches).all()) {
      this.watchers.set(row.id, this.createWatcher(this.rowToManagedSearch(row)));
    }
    this.pruneHits();
    void this.startPendingWatchers();
    this.schedulerTimer = setInterval(() => {
      void this.runSchedulerTick();
    }, this.config.POLL_INTERVAL_MS);
    // The ws-availability probe runs on its OWN timer, independent of the poll
    // tick — a slow handshake must never delay detection.
    this.wsProbeTimer = setInterval(() => {
      void this.probeLiveBackend();
    }, this.config.WS_UPGRADE_PROBE_INTERVAL_MS);
    this.logger.log(
      `watching ${this.watchers.size} search(es); scheduler tick ${this.config.POLL_INTERVAL_MS}ms`,
    );
  }

  onApplicationShutdown(): void {
    if (this.schedulerTimer) clearInterval(this.schedulerTimer);
    if (this.wsProbeTimer) clearInterval(this.wsProbeTimer);
    this.schedulerTimer = null;
    this.wsProbeTimer = null;
    for (const watcher of this.watchers.values()) {
      watcher.engine?.stop();
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

    const row: ManagedSearch = {
      id: ref.searchId,
      realm: ref.realm as Realm,
      league: ref.league,
      label: options.label ?? ref.searchId,
      autoTravel,
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
    await this.startWatcher(watcher);
    this.publishSearchesChanged();
    return this.toRuntimeInfo(watcher);
  }

  update(searchId: string, options: UpdateSearchOptions): SearchRuntimeInfo {
    const watcher = this.requireWatcher(searchId);
    const purchaseMode =
      options.purchaseMode !== undefined ? options.purchaseMode : watcher.row.purchaseMode;
    const autoTravel = options.autoTravel ?? watcher.row.autoTravel;
    this.assertAutoTravelAllowed(autoTravel, watcher.row.filters, purchaseMode);
    const wasEnabled = watcher.row.enabled;
    const enabled = options.enabled ?? wasEnabled;

    watcher.row = {
      ...watcher.row,
      label: options.label ?? watcher.row.label,
      autoTravel,
      purchaseMode,
      enabled,
    };
    this.database
      .update(searches)
      .set({
        label: watcher.row.label,
        autoTravel: watcher.row.autoTravel,
        purchaseMode: watcher.row.purchaseMode,
        enabled: watcher.row.enabled,
      })
      .where(eq(searches.id, searchId))
      .run();

    if (!enabled && wasEnabled) {
      // Paused: stop detection but keep the search and its config.
      watcher.engine?.stop();
      watcher.engine = null;
      this.setStatus(watcher, 'stopped', 'paused');
    } else if (enabled && !wasEnabled) {
      this.setStatus(watcher, 'pending', null);
      void this.startWatcher(watcher);
    } else if (options.purchaseMode !== undefined && enabled) {
      // A purchase-mode change alters the executed query — restart detection.
      watcher.engine?.stop();
      watcher.engine = null;
      watcher.status = 'pending';
      void this.startWatcher(watcher);
    }
    this.publishSearchesChanged();
    return this.toRuntimeInfo(watcher);
  }

  remove(searchId: string): void {
    const watcher = this.requireWatcher(searchId);
    watcher.engine?.stop();
    this.watchers.delete(searchId);
    this.database.delete(searches).where(eq(searches.id, searchId)).run();
    this.publishSearchesChanged();
  }

  listHits(searchId: string | null, limit: number): Hit[] {
    const base = this.database.select().from(hits);
    const rows = (searchId === null ? base : base.where(eq(hits.searchId, searchId)))
      .orderBy(desc(hits.id))
      .limit(limit)
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
      await this.startPendingWatchers();
      // Promote here (not in the probe) so it's synchronous and never races the
      // poll loop below; the probe only flips the flag.
      if (this.liveBackendConfirmedUp) {
        this.liveBackendConfirmedUp = false;
        this.promotePollWatchersToWs();
      }

      const pollWatchers = [...this.watchers.values()].filter(
        (watcher) => watcher.engine instanceof PollEngine,
      );
      if (pollWatchers.length === 0) return;
      const watcher = pollWatchers[this.roundRobinIndex % pollWatchers.length]!;
      this.roundRobinIndex = (this.roundRobinIndex + 1) % Math.max(pollWatchers.length, 1);
      try {
        await (watcher.engine as PollEngine).tick();
      } catch (error) {
        this.setStatus(watcher, 'degraded', error instanceof Error ? error.message : String(error));
      }
    } finally {
      this.tickInFlight = false;
    }
  }

  /** Stops every engine; watchers return to pending and auto-restart post-reset. */
  private windDownForGuard(): void {
    for (const watcher of this.watchers.values()) {
      if (watcher.engine) {
        watcher.engine.stop();
        watcher.engine = null;
        this.setStatus(watcher, 'degraded', 'safety guard tripped — detection halted');
      }
    }
  }

  private async startPendingWatchers(): Promise<void> {
    for (const watcher of this.watchers.values()) {
      if (!watcher.row.enabled) continue;
      if (watcher.engine === null && watcher.status !== 'stopped') {
        await this.startWatcher(watcher);
      }
    }
  }

  private pollWatchers(): Watcher[] {
    return [...this.watchers.values()].filter(
      (watcher) => watcher.row.enabled && watcher.engine instanceof PollEngine,
    );
  }

  /**
   * The single shared "is GGG's live ws backend up?" probe. The backend is up
   * or down globally, so ONE probe answers for every poll-mode search — no
   * per-search probing. Runs on its own timer, fully off the poll tick, and
   * only flips a flag; the next tick does the (synchronous) promotion.
   * Public for tests; production runs it on the ws-probe timer.
   */
  async probeLiveBackend(): Promise<void> {
    if (this.wsProbeInFlight || this.guard.tripped) return;
    const candidates = this.pollWatchers();
    if (candidates.length === 0) return;
    const wsFactory = this.engineRegistry.find((factory) => factory.kind === 'ws');
    if (!wsFactory) return;

    this.wsProbeInFlight = true;
    try {
      if (await wsFactory.probe(this.toRef(candidates[0]!.row))) {
        this.liveBackendConfirmedUp = true;
      }
    } finally {
      this.wsProbeInFlight = false;
    }
  }

  /**
   * Move poll-mode searches onto ws after the shared probe confirmed the
   * backend is up. Respects the guard's ws-connect ceiling: promote only as
   * many as fit this minute, leaving the rest for the next probe window.
   */
  private promotePollWatchersToWs(): void {
    const wsFactory = this.engineRegistry.find((factory) => factory.kind === 'ws');
    if (!wsFactory) return;
    const candidates = this.pollWatchers();
    if (candidates.length === 0) return;

    const budget = this.guard.wsConnectBudgetRemaining();
    const toPromote = candidates.slice(0, budget);
    const deferred = candidates.length - toPromote.length;
    this.logger.log(
      `live ws backend is back — promoting ${toPromote.length}/${candidates.length} search(es) from poll` +
        (deferred > 0
          ? ` (${deferred} deferred to the next probe window — ws-connect ceiling)`
          : ''),
    );
    for (const watcher of toPromote) {
      watcher.engine?.stop();
      watcher.engine = null;
      void this.startWatcher(watcher, wsFactory);
    }
  }

  private async startWatcher(watcher: Watcher, forcedFactory?: EngineFactory): Promise<void> {
    const ref = this.toRef(watcher.row);
    const { query, applied } = applyPurchaseMode(watcher.row.filters, watcher.row.purchaseMode);
    if (!applied) {
      this.publishLog(
        'warn',
        `${watcher.row.id}: purchase mode "${watcher.row.purchaseMode}" has no verified API mapping — using the query's own status`,
        watcher.correlationId,
      );
    }

    let factory = forcedFactory ?? null;
    if (!factory) {
      for (const candidate of this.engineRegistry) {
        if (await candidate.probe(ref)) {
          factory = candidate;
          break;
        }
      }
    }
    if (!factory) {
      this.setStatus(watcher, 'degraded', 'no engine available');
      return;
    }

    const engine = factory.create();
    watcher.engine = engine;
    engine.start(
      { search: ref, query, correlationId: watcher.correlationId },
      {
        onListings: (listings) => this.recordHits(watcher, listings),
        onStatus: (status, detail) => this.setStatus(watcher, status, detail),
        onDemote: (reason) => this.demoteWatcher(watcher, reason),
      },
    );
  }

  /**
   * The engine handed the search back (ws unstable / 1013) — fall to the
   * registry's last-resort strategy (poll) so detection keeps running. The
   * shared background probe re-promotes it to ws when the backend recovers.
   */
  private demoteWatcher(watcher: Watcher, reason: string): void {
    const fallbackFactory = this.engineRegistry[this.engineRegistry.length - 1];
    if (!fallbackFactory) return;
    this.publishLog(
      'warn',
      `${watcher.row.id}: demoting to ${fallbackFactory.kind} — ${reason}`,
      watcher.correlationId,
    );
    watcher.engine?.stop();
    watcher.engine = null;
    void this.startWatcher(watcher, fallbackFactory);
  }

  private recordHits(watcher: Watcher, listings: Listing[]): void {
    for (const listing of listings) {
      this.database
        .insert(hits)
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
      watcher.hitCount += 1;
      watcher.lastHitAt = listing.detectedAt;
      this.hitsSincePrune += 1;
      this.realtimeBus.publish({ type: 'hit', listing });
      // autoTravel: the TravelService consumes hit events in Phase 2.
    }
    if (this.hitsSincePrune >= PRUNE_EVERY_HITS) {
      this.hitsSincePrune = 0;
      this.pruneHits();
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

  private setStatus(watcher: Watcher, status: EngineStatus, detail: string | null): void {
    watcher.status = status;
    watcher.statusDetail = detail;
    this.realtimeBus.publish({
      type: 'engine-status',
      searchId: watcher.row.id,
      engine: watcher.engine?.kind ?? 'poll',
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

  private createWatcher(row: ManagedSearch): Watcher {
    return {
      row,
      engine: null,
      status: row.enabled ? 'pending' : 'stopped',
      statusDetail: row.enabled ? null : 'paused',
      correlationId: randomUUID(),
      hitCount: 0,
      lastHitAt: null,
    };
  }

  private rowToManagedSearch(row: typeof searches.$inferSelect): ManagedSearch {
    return {
      id: row.id,
      realm: row.realm as Realm,
      league: row.league,
      label: row.label,
      autoTravel: row.autoTravel,
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
      engine: watcher.engine?.kind ?? null,
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
