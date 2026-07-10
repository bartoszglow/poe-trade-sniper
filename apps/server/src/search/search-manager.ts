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
  DealWatchState,
  MarketPriceSnapshot,
  EngineKind,
  EngineStatus,
  ExportedRoom,
  ExportedSearchEntry,
  Hit,
  ImportConflictMode,
  ImportResult,
  Listing,
  ManagedSearch,
  PurchaseMode,
  Realm,
  RoomDeleteMode,
  RoomInfo,
  SearchLayoutEntry,
  SearchPreview,
  SearchRuntimeInfo,
  SearchesView,
} from '@poe-sniper/shared';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { errorMessage } from '../util/error-message.js';
import { GUARD_WINDOW_MS, OutboundGuard } from '../guard/outbound-guard.js';
import { PermissionGateService } from '../permissions/permission-gate.service.js';
import { DATABASE } from '../db/db.module.js';
import type { SniperDatabase } from '../db/migrate.js';
import { hits, rooms, searches } from '../db/schema.js';
import type { DetectionEngine, EngineContext } from '../engines/detection-engine.js';
import { PollEngine } from '../engines/poll-engine.js';
import { WS_RATE_LIMITED_DETAIL } from '../engines/ws-engine.js';
import { RealtimeBus } from '../events/realtime-bus.js';
import { applyPurchaseMode } from '../trade-api/purchase-mode.js';
import {
  NoSessionError,
  TradeApiClient,
  type TradeSearchRef,
} from '../trade-api/trade-api.client.js';
import { offerKey } from '@poe-sniper/shared';
import { parseDealWatchState } from './deal-watch-state.schema.js';
import { parseMarketPriceSnapshot } from './market-price-snapshot.schema.js';
import { ENGINE_REGISTRY, type EngineFactory } from './engine-registry.js';
import { HitDecoratorRegistry } from './hit-decorator.js';
import { LiveOfferRegistry } from './live-offer-registry.js';
import { parseSearchInput, queryStatusOption } from './search-input.js';
import { buildLayout, normalizeLayout, type LayoutSearchState } from './search-layout.js';

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
  /** Archive / restore (#35): archiving stops detection and removes the search
   *  from the layout; every flag survives, so restore re-arms as it was. */
  archived?: boolean;
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

/** Stagger-drip pacing vs the guard budget: 1.2 → drip uses ~5/6 of the
 *  ws-connect ceiling, leaving the rest for organic reconnect churn. */
const GUARD_STAGGER_HEADROOM_FACTOR = 1.2;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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
  /** True while ws is in the 1013 rate-limit backoff — surfaced to the operator
   *  even under poll coverage (poll normally owns the display). */
  wsRateLimited: boolean;
  status: EngineStatus;
  statusDetail: string | null;
  correlationId: string;
  hitCount: number;
  lastHitAt: string | null;
  /** Hourly market-price snapshot (D-dw-14) — NON-deal rows only; runtime-only
   *  state (never on ManagedSearch, so exports and events never carry it). */
  marketPrice: MarketPriceSnapshot | null;
}

/** In-memory room state (#33). Map insertion order = top-level room order. */
interface RoomState {
  id: string;
  name: string;
  collapsed: boolean;
  /** Room master switch (D-room-1 v2) — a gate on top of member.enabled, never
   *  overwrites it. See the `rooms.enabled` schema comment. */
  enabled: boolean;
  addedAt: string;
  /** Last persisted top-level index — anchors the room when it has no members. */
  position: number;
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
  /** Named search groups (#33); iteration order = top-level room order. */
  private readonly rooms = new Map<string, RoomState>();
  private schedulerTimer: NodeJS.Timeout | null = null;
  private roundRobinIndex = 0;
  private tickInFlight = false;
  /** True while a staggered start-drip is in flight — keeps overlapping ticks/resumes from double-starting. */
  private startingWatchers = false;
  private hitsSincePrune = 0;
  /** Durable "the operator has ever received a hit" — seeded lazily from the hits
   *  table (orphaned rows survive a search delete) and latched on the first fresh
   *  hit. Backs the onboarding checklist so deleting a search can't regress it (#20). */
  private everReceivedHit = false;
  /** Global pause: every enabled search halts as PAUSED until resumed. */
  private detectionPaused = false;
  /** Deal-row deletion callback (see setDealRowCleanup). */
  private dealRowCleanup: ((watchId: string) => void) | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly database: SniperDatabase,
    @Inject(ENGINE_REGISTRY) private readonly engineRegistry: EngineFactory[],
    @Inject(TradeApiClient) private readonly tradeApi: TradeApiClient,
    @Inject(RealtimeBus) private readonly realtimeBus: RealtimeBus,
    @Inject(OutboundGuard) private readonly guard: OutboundGuard,
    @Inject(PermissionGateService) private readonly gate: PermissionGateService,
    @Inject(LiveOfferRegistry) private readonly offerRegistry: LiveOfferRegistry,
    @Inject(HitDecoratorRegistry) private readonly hitDecorators: HitDecoratorRegistry,
  ) {}

  onApplicationBootstrap(): void {
    // Rehydrate rooms first (memberships are validated against them), then the
    // searches in the user's drag order. `position` carries TWO scopes (#33): the
    // top-level index (rooms + ungrouped searches share one sequence) and the
    // within-room index; nulls sort last by addedAt in their scope. The flattened
    // depth-first result IS the Map insertion order = list order = poll rotation.
    const roomRows = this.database
      .select()
      .from(rooms)
      .orderBy(
        asc(sql`coalesce(${rooms.position}, ${Number.MAX_SAFE_INTEGER})`),
        asc(rooms.addedAt),
      )
      .all();
    for (const roomRow of roomRows) {
      this.rooms.set(roomRow.id, {
        id: roomRow.id,
        name: roomRow.name,
        collapsed: roomRow.collapsed,
        enabled: roomRow.enabled,
        addedAt: roomRow.addedAt,
        position: roomRow.position ?? Number.MAX_SAFE_INTEGER,
      });
    }
    for (const row of this.rowsInFlattenedOrder()) {
      this.watchers.set(
        row.id,
        this.createWatcher(this.rowToManagedSearch(row), parseMarketPriceSnapshot(row.marketPrice)),
      );
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
      roomId: null,
      archivedAt: null,
      dealWatch: null,
    };
    this.database
      .insert(searches)
      .values({ ...row, filters: resolvedQuery })
      .run();

    const watcher = this.createWatcher(row);
    watcher.correlationId = correlationId;
    this.watchers.set(row.id, watcher);
    this.startEnabledWatcher(watcher);
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
    const wasArchived = watcher.row.archivedAt !== null;
    const archived = options.archived ?? wasArchived;
    // The original archive time survives a redundant "archive again".
    const archivedAt = archived ? (watcher.row.archivedAt ?? new Date().toISOString()) : null;

    watcher.row = {
      ...watcher.row,
      label: options.label ?? watcher.row.label,
      autoTravel,
      autoBuy,
      purchaseMode,
      enabled,
      archivedAt,
    };
    this.database
      .update(searches)
      .set({
        label: watcher.row.label,
        autoTravel: watcher.row.autoTravel,
        autoBuy: watcher.row.autoBuy,
        purchaseMode: watcher.row.purchaseMode,
        enabled: watcher.row.enabled,
        archivedAt: watcher.row.archivedAt,
      })
      .where(eq(searches.id, searchId))
      .run();

    if (archived && !wasArchived) {
      // Archiving (#35): detection stops; flags/history/membership survive.
      this.stopEngines(watcher);
      this.publishEngineStatus(watcher, 'stopped', 'archived');
    } else if (!archived && wasArchived) {
      // Restoring: come back exactly as configured before the archive. The
      // enabled check comes FIRST — a disabled restore is 'stopped' even under
      // a global pause (it would otherwise wear 'paused' forever after resume,
      // since the resume drip skips disabled watchers).
      if (!watcher.row.enabled) {
        this.publishEngineStatus(watcher, 'stopped', 'paused');
      } else {
        this.startEnabledWatcher(watcher);
      }
      // The row's persisted position went stale while archived (persistLayout
      // never writes archived rows) — re-persist the canonical layout so the
      // restored slot survives a restart instead of reshuffling the room.
      const restoredLayout = this.currentLayout();
      this.database.transaction((tx) => this.persistLayout(tx, restoredLayout));
      this.syncRoomPositions(restoredLayout);
    } else if (!archived) {
      if (!enabled && wasEnabled) {
        // Per-search disable: stop detection but keep the search and its config.
        this.stopEngines(watcher);
        this.publishEngineStatus(watcher, 'stopped', 'paused');
      } else if (enabled && !wasEnabled) {
        // Re-enabled — start now, unless a gate holds it (global pause or a
        // disabled room), in which case it waits labelled and comes up when the
        // gate lifts.
        this.startEnabledWatcher(watcher);
      } else if (
        options.purchaseMode !== undefined &&
        enabled &&
        !this.detectionPaused &&
        this.roomEnabled(watcher)
      ) {
        // A purchase-mode change alters the executed query — restart detection
        // (only if it's actually running; a gated search picks up the new query
        // when it next starts).
        this.stopEngines(watcher);
        this.startWatcher(watcher);
      }
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
    if ((watcher.row.dealWatch ?? null) !== null) {
      // The id/query of a deal-mode search is system-managed (plan 41, D-dw-7):
      // a manual re-point would fight the auto re-derive and lose silently.
      throw new ConflictException(
        `search ${searchId} is managed by deal-watch — disable deal mode to edit its id`,
      );
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
    const newWatcher = this.swapWatcherRow(searchId, newRow);
    newWatcher.correlationId = correlationId;
    if (newRow.archivedAt !== null) {
      // Re-pointed while archived: stays archived (createWatcher marked it).
    } else if (this.detectionPaused) {
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
    const removedWatchId = watcher.row.dealWatch?.watchId;
    if (removedWatchId !== undefined) this.dealRowCleanup?.(removedWatchId);
    this.publishSearchesChanged();
  }

  /**
   * The id-swap transaction shared by editSearch and the deal seam (D-dw-7):
   * insert the new row, re-point hits, delete the old row (declared FK cascade
   * never fires — the pragma is OFF), then swap the watcher IN PLACE. The
   * watchers Map's insertion order IS the displayed list order and the poll
   * rotation, so a naive delete + set would drop the search to the bottom of
   * its scope — the Map is rebuilt substituting the new id at the old slot.
   * Live hit counters carry over. Engines are STOPPED here; the caller owns
   * validation and restart semantics.
   */
  private swapWatcherRow(oldId: string, newRow: ManagedSearch): Watcher {
    const watcher = this.requireWatcher(oldId);
    // Snapshot the displayed status BEFORE stopEngines mutates it to 'stopped' —
    // otherwise the D-dw-20 "carry" below copies 'stopped', which strands an
    // enabled watcher (the drip skips 'stopped'). restartViaDrip normalizes a
    // non-running carried status back to 'pending'; here we preserve the REAL one.
    const priorStatus = watcher.status;
    const priorStatusDetail = watcher.statusDetail;
    this.database.transaction((tx) => {
      tx.insert(searches)
        .values({ ...newRow, filters: newRow.filters })
        .run();
      tx.update(hits).set({ searchId: newRow.id }).where(eq(hits.searchId, oldId)).run();
      tx.delete(searches).where(eq(searches.id, oldId)).run();
    });
    this.stopEngines(watcher);
    const newWatcher = this.createWatcher(newRow);
    newWatcher.hitCount = watcher.hitCount;
    newWatcher.lastHitAt = watcher.lastHitAt;
    // Carry the displayed status across the swap (D-dw-20): a deal re-derive is a
    // routine cap update on a near-identical query — the caller can keep showing
    // the prior status (typically active/ws) through the brief reconnect instead
    // of flashing pending/degraded. onWsStatus takes over when the new socket
    // resolves; a genuine failure still degrades it.
    newWatcher.status = priorStatus;
    newWatcher.statusDetail = priorStatusDetail;
    const reordered = [...this.watchers.entries()].map((entry) =>
      entry[0] === oldId ? ([newRow.id, newWatcher] as [string, Watcher]) : entry,
    );
    this.watchers.clear();
    for (const [key, value] of reordered) this.watchers.set(key, value);
    return newWatcher;
  }

  // ---------------------------------------------------------------------------
  // Deal-watch seam (plan 41, D-dw-7) — consumed ONLY by the DealWatchService.
  // Deal mode transforms the operator's own search in place: the service owns
  // baselines/caps/queries, this seam owns row/watcher/DB consistency.
  // ---------------------------------------------------------------------------

  /** Narrow read for the deal decorator/service — null when unknown. */
  getRow(searchId: string): ManagedSearch | null {
    return this.watchers.get(searchId)?.row ?? null;
  }

  /** Rows currently in deal mode (any status), in list order. */
  dealModeRows(): ManagedSearch[] {
    return [...this.watchers.values()]
      .map((watcher) => watcher.row)
      .filter((row) => (row.dealWatch ?? null) !== null);
  }

  /** Whether a watcher's live ws is currently connected (deal expiry heuristic). */
  isWsConnected(searchId: string): boolean {
    return this.watchers.get(searchId)?.wsConnected ?? false;
  }

  isDetectionGloballyPaused(): boolean {
    return this.detectionPaused;
  }

  /**
   * Narrow cleanup seam (plan 41, review F2): the deal-watch module registers a
   * callback invoked with the watchId whenever a deal-mode row is deleted here
   * (operator DELETE, import replace-mode) so its runtime maps + baseline
   * history never orphan until the boot sweep. A callback slot, not an event —
   * exactly one consumer owns deal cleanup.
   */
  setDealRowCleanup(cleanup: (watchId: string) => void): void {
    this.dealRowCleanup = cleanup;
  }

  /**
   * Persist a deal-state change that does NOT alter the watched query/id
   * (baseline refresh, status transition, threshold edit before its re-derive).
   */
  updateDealState(searchId: string, dealWatch: DealWatchState | null): SearchRuntimeInfo {
    const watcher = this.requireWatcher(searchId);
    watcher.row = { ...watcher.row, dealWatch };
    this.database.update(searches).set({ dealWatch }).where(eq(searches.id, searchId)).run();
    this.publishSearchesChanged();
    return this.toRuntimeInfo(watcher);
  }

  /**
   * Persist a market-price snapshot for an ORDINARY row (D-dw-14) — or clear it
   * (deal enable takes over, id re-point invalidates). Row already gone (check
   * finished after a delete) → silent no-op; this is best-effort display data.
   */
  updateMarketSnapshot(searchId: string, snapshot: MarketPriceSnapshot | null): void {
    const watcher = this.watchers.get(searchId);
    if (!watcher) return;
    watcher.marketPrice = snapshot;
    this.database
      .update(searches)
      .set({ marketPrice: snapshot })
      .where(eq(searches.id, searchId))
      .run();
    this.publishSearchesChanged();
  }

  /** The row's current market snapshot (deal-enable reuse; D-dw-14). */
  getMarketSnapshot(searchId: string): MarketPriceSnapshot | null {
    return this.watchers.get(searchId)?.marketPrice ?? null;
  }

  /**
   * Rows the market-price loop may check (D-dw-14): enabled, non-archived and
   * NOT deal-mode (deal rows are covered by their own refresh loop).
   */
  marketCheckCandidates(): Array<{ row: ManagedSearch; snapshot: MarketPriceSnapshot | null }> {
    return [...this.watchers.values()]
      .filter(
        (watcher) =>
          watcher.row.enabled &&
          watcher.row.archivedAt === null &&
          (watcher.row.dealWatch ?? null) === null,
      )
      .map((watcher) => ({ row: watcher.row, snapshot: watcher.marketPrice }));
  }

  /**
   * Swap a deal-mode search onto a new GGG id + watched query (derive /
   * re-derive / disable-restore):
   * - `next.id` === current id → filters/state update only (ids are
   *   content-addressed — an unchanged query is a no-op re-derive,
   *   api-notes 2026-07-05); engines restart only if the query changed;
   * - `next.id` collides with ANOTHER watched row → ConflictException (the
   *   caller maps it to the `derive-conflict` status);
   * - otherwise the shared swap transaction runs and engines restart via the
   *   pending/stagger drip — NEVER an immediate start (D-dw-8: deal churn must
   *   ride the guard-safe drip; a burst of immediate ws connects can trip the
   *   latched OutboundGuard).
   */
  swapDealSearch(
    currentId: string,
    next: { id: string; filters: unknown; dealWatch: DealWatchState | null },
  ): SearchRuntimeInfo {
    const watcher = this.requireWatcher(currentId);
    if (next.id === currentId) {
      const queryChanged = JSON.stringify(watcher.row.filters) !== JSON.stringify(next.filters);
      watcher.row = { ...watcher.row, filters: next.filters, dealWatch: next.dealWatch };
      this.database
        .update(searches)
        .set({ filters: next.filters, dealWatch: next.dealWatch })
        .where(eq(searches.id, currentId))
        .run();
      // preserveStatus: a deal re-derive keeps the prior status through the
      // reconnect (D-dw-20) — no pending/degraded flash for a routine cap update.
      if (queryChanged) this.restartViaDrip(watcher, true);
      this.publishSearchesChanged();
      return this.toRuntimeInfo(watcher);
    }
    if (this.watchers.has(next.id)) {
      throw new ConflictException(`search ${next.id} is already watched`);
    }
    const newRow: ManagedSearch = {
      ...watcher.row,
      id: next.id,
      filters: next.filters,
      dealWatch: next.dealWatch,
    };
    const newWatcher = this.swapWatcherRow(currentId, newRow);
    this.restartViaDrip(newWatcher, true);
    this.publishSearchesChanged();
    return this.toRuntimeInfo(newWatcher);
  }

  /**
   * Stop engines and hand the watcher to the stagger drip (guard-safe restart).
   * `preserveStatus` (deal re-derive, D-dw-20) keeps the currently-displayed
   * status instead of publishing `pending` — the near-identical capped query
   * reconnects within seconds and onWsStatus/onPollStatus take over; a real
   * failure still degrades. The engines DO still stop + drip (guard accounting
   * unchanged) — only the displayed status is held.
   */
  private restartViaDrip(watcher: Watcher, preserveStatus = false): void {
    this.stopEngines(watcher);
    if (watcher.row.archivedAt !== null || !watcher.row.enabled) return;
    if (this.detectionPaused) {
      this.publishEngineStatus(watcher, 'paused', 'globally paused');
      return;
    }
    if (!this.roomEnabled(watcher)) {
      this.publishEngineStatus(watcher, 'paused', 'room paused');
      return;
    }
    // Preserve only a RUNNING-ish status (avoids a 'degraded'→'pending' flash on a
    // deal re-derive of a live search). A carried 'stopped'/'paused' is stale here
    // — and the drip's `status !== 'stopped'` filter would EXCLUDE a 'stopped'
    // watcher forever (enabled=true, engines null: the deal-add strand) — so
    // normalize it to 'pending' before dripping.
    if (!preserveStatus || watcher.status === 'stopped' || watcher.status === 'paused') {
      this.publishEngineStatus(watcher, 'pending', null);
    }
    this.startPendingWatchers();
  }

  /**
   * Apply a user-defined layout (drag-and-drop, #33): top-level order of rooms +
   * ungrouped searches, membership, and within-room order — all in one call, so a
   * drag into/out of a room commits atomically with the ordering it implies. The
   * flattened result rebuilds the watchers Map, which is BOTH the displayed list
   * order AND the round-robin poll rotation (top searches poll a tick earlier).
   * Race-tolerant (see normalizeLayout): unknown ids are skipped and unmentioned
   * searches/rooms are appended so nothing is dropped. Never touches the buy
   * lock / travel queue.
   */
  reorder(requestedLayout: SearchLayoutEntry[]): SearchesView {
    const normalized = normalizeLayout(requestedLayout, this.layoutSearchStates(), [
      ...this.rooms.keys(),
    ]);
    this.database.transaction((tx) => this.persistLayout(tx, normalized.layout));
    this.applyLayoutToMemory(normalized.layout, normalized.flattened);
    this.publishSearchesChanged();
    return this.view();
  }

  /** The full Searches view: flattened searches + rooms + the top-level layout tree. */
  view(): SearchesView {
    return { searches: this.list(), rooms: this.listRooms(), layout: this.currentLayout() };
  }

  listRooms(): RoomInfo[] {
    return [...this.rooms.values()].map((room) => ({
      id: room.id,
      name: room.name,
      collapsed: room.collapsed,
      enabled: room.enabled,
      addedAt: room.addedAt,
    }));
  }

  createRoom(name: string): SearchesView {
    const room: RoomState = {
      id: randomUUID(),
      name: name.trim(),
      collapsed: false,
      enabled: true,
      addedAt: new Date().toISOString(),
      // Appended at the end of the top level.
      position: this.currentLayout().length,
    };
    this.database.insert(rooms).values(room).run();
    this.rooms.set(room.id, room);
    this.publishSearchesChanged();
    return this.view();
  }

  updateRoom(roomId: string, options: { name?: string; collapsed?: boolean }): SearchesView {
    const room = this.requireRoom(roomId);
    room.name = options.name?.trim() ?? room.name;
    room.collapsed = options.collapsed ?? room.collapsed;
    this.database
      .update(rooms)
      .set({ name: room.name, collapsed: room.collapsed })
      .where(eq(rooms.id, roomId))
      .run();
    this.publishSearchesChanged();
    return this.view();
  }

  /**
   * Master enable/disable for a whole room (D-room-1 v2): flips the room's OWN
   * `enabled` gate — it does NOT rewrite any member's individual `enabled`. So an
   * individually-paused member stays paused through a room OFF→ON round-trip (the
   * old "overwrite by design" resurrected them, diverging the toggle from the
   * status — the bug this fixes). Disabling stops each enabled member's engines
   * at once (burst-safe). Enabling does NOT start N watchers directly — N
   * simultaneous ws-connects would trip GGG's per-minute connect latch — it marks
   * them PENDING and lets the staggered drip (startPendingWatchers) bring them up.
   */
  setRoomEnabled(roomId: string, enabled: boolean): SearchesView {
    const room = this.requireRoom(roomId);
    if (room.enabled === enabled) return this.view();
    room.enabled = enabled;
    this.database.update(rooms).set({ enabled }).where(eq(rooms.id, roomId)).run();
    // Archived members are invisible in the room — the master switch skips them.
    const members = [...this.watchers.values()].filter(
      (watcher) => watcher.row.roomId === roomId && watcher.row.archivedAt === null,
    );
    for (const watcher of members) {
      // Individually-disabled members own their 'stopped' state — the room gate
      // never touches them, so their toggle stays OFF regardless of this switch.
      if (!watcher.row.enabled) continue;
      if (!enabled) {
        this.stopEngines(watcher);
        this.publishEngineStatus(watcher, 'paused', 'room paused');
      } else if (this.detectionPaused) {
        this.publishEngineStatus(watcher, 'paused', 'globally paused');
      } else {
        // PENDING (not an immediate start) → picked up by the stagger drip below.
        this.publishEngineStatus(watcher, 'pending', null);
      }
    }
    if (enabled && !this.detectionPaused) this.startPendingWatchers();
    this.publishSearchesChanged();
    return this.view();
  }

  /**
   * Delete a room with an operator-chosen fate for its members (D-room-2 — the
   * API forces the choice, there is no default). `release` keeps the members
   * exactly where they sat, now top-level; `delete-searches` tears each member
   * down like a normal search removal. Row deletes + the layout re-persist are
   * one transaction; hits of deleted searches are handled as in `remove()`.
   */
  deleteRoom(roomId: string, mode: RoomDeleteMode): SearchesView {
    this.requireRoom(roomId);
    const allMembers = [...this.watchers.values()].filter(
      (watcher) => watcher.row.roomId === roomId,
    );
    // Archived members are invisible in the room's UI — `delete-searches` must
    // never silently destroy them; they are RELEASED in both modes (#35).
    const members = allMembers.filter((watcher) => watcher.row.archivedAt === null);
    const archivedMembers = allMembers.filter((watcher) => watcher.row.archivedAt !== null);
    for (const member of members) {
      if (mode === 'delete-searches') {
        this.stopEngines(member);
        this.watchers.delete(member.row.id);
      } else {
        // Release: same flattened slot, no room — the layout keeps it in place.
        member.row = { ...member.row, roomId: null };
      }
    }
    for (const member of archivedMembers) {
      member.row = { ...member.row, roomId: null };
    }
    this.rooms.delete(roomId);
    const layout = this.currentLayout();
    this.database.transaction((tx) => {
      if (mode === 'delete-searches') {
        for (const member of members) {
          tx.delete(searches).where(eq(searches.id, member.row.id)).run();
        }
      }
      for (const member of archivedMembers) {
        tx.update(searches).set({ roomId: null }).where(eq(searches.id, member.row.id)).run();
      }
      tx.delete(rooms).where(eq(rooms.id, roomId)).run();
      this.persistLayout(tx, layout);
    });
    this.syncRoomPositions(layout);
    this.publishSearchesChanged();
    return this.view();
  }

  /**
   * Re-resolve a single listing to recover a FRESH hideout token for a retry. Tokens die
   * ~300 s and are never persisted, and GGG re-serves offers under new result-hash ids
   * (see offer.ts), so a retry can't reuse the stored token/id — it must re-resolve.
   * Tier 1: re-fetch the known id (cheap, FETCH bucket); if it still resolves to the SAME
   * offer with a token, use it. Tier 2 (fallback): re-run the search newest-first and match
   * the offer by its stable `offerKey`. Returns the fresh listing or null (sold / delisted /
   * not in the current top results). Tier 2 spends a SEARCH-bucket hit, so callers MUST keep
   * this manual + single-shot — never an auto loop (search lockouts stack for 30 min).
   */
  async refreshListing(
    searchId: string,
    listingId: string,
    targetOfferKey: string,
  ): Promise<Listing | null> {
    const watcher = this.watchers.get(searchId);
    if (!watcher) return null;
    const search = this.toRef(watcher.row);
    const correlationId = randomUUID();
    // Tier 1 — fetch the known id; if it still maps to the same offer with a token, done.
    try {
      const [byId] = await this.tradeApi.fetchListings(search, [listingId], correlationId);
      if (byId?.hideoutToken && offerKey(byId) === targetOfferKey) return byId;
    } catch (error) {
      this.logger.warn(`refresh tier-1 fetch failed: ${errorMessage(error)}`);
    }
    // Tier 2 — re-search (newest-first) + match by the stable offer identity.
    const { ids } = await this.tradeApi.executeSearch(search, watcher.row.filters, correlationId);
    if (ids.length === 0) return null;
    const fresh = await this.tradeApi.fetchListings(
      search,
      ids.slice(0, this.config.FETCH_BATCH_SIZE),
      correlationId,
    );
    return (
      fresh.find((listing) => listing.hideoutToken && offerKey(listing) === targetOfferKey) ?? null
    );
  }

  /** All configured searches as a round-trippable list (live rows; hold no credentials). */
  exportSearches(): ExportedSearchEntry[] {
    // Deal watches export CONFIG only (D-dw-10): baseline/cap/derived-id are
    // machine-local runtime state, and watchId is a machine-local identity
    // (history rows key on it) — the import mints a fresh one, so re-importing
    // a file can never collide with a live watch (review F8). The row id may be
    // a derived id; the config keeps the operator's original for restore.
    return [...this.watchers.values()].map((watcher) => {
      const dealWatch = watcher.row.dealWatch ?? null;
      return {
        ...watcher.row,
        dealWatch:
          dealWatch === null
            ? null
            : {
                mode: dealWatch.mode,
                thresholdValue: dealWatch.thresholdValue,
                unit: dealWatch.unit,
                baselineSampleSize: dealWatch.baselineSampleSize,
                refreshIntervalMs: dealWatch.refreshIntervalMs,
                definition: dealWatch.definition,
                originalSearchId: dealWatch.originalSearchId,
                originalPriceFilter: dealWatch.originalPriceFilter,
              },
      };
    });
  }

  /** Rooms as exported alongside the searches (ids correlate memberships in the file). */
  exportRooms(): ExportedRoom[] {
    return [...this.rooms.values()].map((room) => ({
      id: room.id,
      name: room.name,
      collapsed: room.collapsed,
    }));
  }

  /**
   * Restore searches from an export. Each entry is inserted with its stored `filters`
   * AS-IS — no `resolveQuery()` (we keep no raw input and want import to work offline);
   * the watcher is re-created and started. Auto-travel/buy that fail the safety gate are
   * coerced OFF rather than failing the whole entry. On id conflict: `skip` keeps the
   * existing search, `replace` removes then re-inserts it. Rooms in the file are matched
   * to existing rooms BY NAME (else created), and memberships remapped through that —
   * file room ids never leak into this database. Never accepts credentials — the entry
   * shape has none.
   */
  importSearches(
    entries: ManagedSearch[],
    exportedRooms: ExportedRoom[],
    mode: ImportConflictMode,
  ): ImportResult {
    const roomIdByExportedId = this.importRooms(exportedRooms);
    let imported = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (const entry of entries) {
      try {
        if (this.watchers.has(entry.id)) {
          if (mode === 'skip') {
            skipped += 1;
            continue;
          }
          this.remove(entry.id);
        }
        let autoTravel = entry.autoTravel;
        let autoBuy = entry.autoBuy;
        try {
          this.assertAutoTravelAllowed(autoTravel, entry.filters, entry.purchaseMode);
        } catch {
          autoTravel = false;
        }
        if (!autoTravel) autoBuy = false; // autoBuy requires autoTravel
        try {
          this.assertAutoBuyAllowed(autoBuy);
        } catch {
          autoBuy = false;
        }
        const row: ManagedSearch = {
          id: entry.id,
          realm: entry.realm,
          league: entry.league,
          label: entry.label,
          autoTravel,
          autoBuy,
          enabled: entry.enabled,
          purchaseMode: entry.purchaseMode,
          filters: entry.filters,
          addedAt: entry.addedAt,
          roomId: entry.roomId !== null ? (roomIdByExportedId.get(entry.roomId) ?? null) : null,
          archivedAt: entry.archivedAt ?? null,
          // Import always lands as pending-derive (ImportService rebuilt it) —
          // the drift loop derives fresh on THIS machine (D-dw-10).
          dealWatch: entry.dealWatch ?? null,
        };
        this.database
          .insert(searches)
          .values({ ...row, filters: row.filters })
          .run();
        const watcher = this.createWatcher(row);
        this.watchers.set(row.id, watcher);
        if (row.archivedAt !== null) {
          // Archived imports stay archived — createWatcher already marked them.
        } else if (this.detectionPaused) {
          this.publishEngineStatus(watcher, 'paused', 'globally paused');
        } else if (row.enabled) {
          this.startWatcher(watcher);
        }
        imported += 1;
      } catch (error) {
        errors.push(`${entry.id}: ${errorMessage(error)}`);
      }
    }
    if (imported > 0) this.publishSearchesChanged();
    return { imported, skipped, errors };
  }

  /**
   * Materialize an export's rooms: an existing room with the same name is reused
   * (idempotent re-import), anything else is created fresh with a NEW id and
   * appended at the top level. Returns file-room-id → actual-room-id.
   */
  private importRooms(exportedRooms: ExportedRoom[]): Map<string, string> {
    const roomIdByExportedId = new Map<string, string>();
    for (const exportedRoom of exportedRooms) {
      const existing = [...this.rooms.values()].find((room) => room.name === exportedRoom.name);
      if (existing) {
        roomIdByExportedId.set(exportedRoom.id, existing.id);
        continue;
      }
      const room: RoomState = {
        id: randomUUID(),
        name: exportedRoom.name,
        collapsed: exportedRoom.collapsed,
        // Room master state is runtime-only (not in the export file) — a fresh
        // import comes up active, like a newly created room.
        enabled: true,
        addedAt: new Date().toISOString(),
        position: this.currentLayout().length,
      };
      this.database.insert(rooms).values(room).run();
      this.rooms.set(room.id, room);
      roomIdByExportedId.set(exportedRoom.id, room.id);
    }
    return roomIdByExportedId;
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
      deal: (row.deal as Hit['deal']) ?? null,
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

  /**
   * The league the operator is actually playing, inferred from watched searches
   * — the MOST COMMON league among them (archived included). Null when there
   * are no searches. Used by the price checker (#37): a price check has no
   * search context of its own, so it borrows the league the searches encode
   * rather than a hardcoded default.
   */
  getPrimaryLeague(): string | null {
    const counts = new Map<string, number>();
    for (const watcher of this.watchers.values()) {
      counts.set(watcher.row.league, (counts.get(watcher.row.league) ?? 0) + 1);
    }
    let best: string | null = null;
    let bestCount = 0;
    for (const [league, count] of counts) {
      if (count > bestCount) {
        best = league;
        bestCount = count;
      }
    }
    return best;
  }

  summary(): { total: number; byStatus: Record<string, number> } {
    const byStatus: Record<string, number> = {};
    for (const watcher of this.watchers.values()) {
      byStatus[watcher.status] = (byStatus[watcher.status] ?? 0) + 1;
    }
    return { total: this.watchers.size, byStatus };
  }

  /**
   * Whether ANY hit was ever recorded (onboarding checklist, #20). Reads a durable
   * signal — a single row in the hits table, which survives deleting the search
   * that produced it — so the "first hit" step never regresses when the operator
   * prunes searches. Monotonic + cached: once true it stays true for the session.
   */
  hasEverReceivedHit(): boolean {
    if (this.everReceivedHit) return true;
    this.everReceivedHit =
      this.database.select({ id: hits.id }).from(hits).limit(1).all().length > 0;
    return this.everReceivedHit;
  }

  isDetectionPaused(): boolean {
    return this.detectionPaused;
  }

  /** Whether this watcher's room permits running. Top-level searches (no room)
   *  have no room gate; a member defers to its room's master switch. */
  private roomEnabled(watcher: Watcher): boolean {
    const roomId = watcher.row.roomId;
    return roomId === null || (this.rooms.get(roomId)?.enabled ?? true);
  }

  /**
   * The single decision for an ENABLED, non-archived watcher: start it, or label
   * WHY it's held. Gate order = the reasons it can be blocked — global pause,
   * then its room's master switch. The individually-disabled and archived cases
   * are handled by callers (they own distinct 'stopped' labels); this method is
   * the one place the "enabled but not running" status is derived, so the toggle
   * (member.enabled) and the status can never disagree.
   */
  private startEnabledWatcher(watcher: Watcher): void {
    if (this.detectionPaused) {
      this.publishEngineStatus(watcher, 'paused', 'globally paused');
    } else if (!this.roomEnabled(watcher)) {
      this.publishEngineStatus(watcher, 'paused', 'room paused');
    } else {
      // startWatcher doesn't publish until the socket reports — so if the row was
      // sitting at a stale 'stopped'/'paused' (e.g. a re-enable), show 'pending'
      // at once, or the toggle (ON) and the status would disagree until connect.
      if (watcher.status === 'stopped' || watcher.status === 'paused') {
        this.publishEngineStatus(watcher, 'pending', null);
      }
      this.startWatcher(watcher);
    }
  }

  /**
   * Global pause/resume. Pausing halts every ENABLED search as PAUSED (distinct
   * from a per-search STOPPED) without clearing its enabled flag; resuming
   * brings them all back. Already-disabled searches are left untouched.
   */
  setDetectionPaused(paused: boolean): boolean {
    if (paused === this.detectionPaused) return this.detectionPaused;
    this.detectionPaused = paused;
    if (paused) {
      for (const watcher of this.watchers.values()) {
        // Skip searches already held by another gate: archived, individually
        // disabled, or in a disabled room — a global pause must not relabel them
        // (their own status is authoritative and resume's drip re-gates on it).
        if (!watcher.row.enabled || watcher.row.archivedAt !== null || !this.roomEnabled(watcher)) {
          continue;
        }
        this.stopEngines(watcher);
        this.publishEngineStatus(watcher, 'paused', 'globally paused');
      }
    } else {
      // Resume: drip the starts out one-by-one with a gap (see startPendingWatchers)
      // so re-enabling detection with many searches doesn't burst the ws-connect latch.
      this.startPendingWatchers();
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
        (watcher) =>
          watcher.row.enabled &&
          watcher.row.archivedAt === null &&
          watcher.pollEngine !== null &&
          !watcher.wsConnected,
      );
      if (pollWatchers.length === 0) return;
      const watcher = pollWatchers[this.roundRobinIndex % pollWatchers.length]!;
      this.roundRobinIndex = (this.roundRobinIndex + 1) % Math.max(pollWatchers.length, 1);
      try {
        await (watcher.pollEngine as PollEngine).tick();
      } catch (error) {
        // Raw reason to the logs only; the UI status carries a localized 'error' code.
        this.logger.warn(`poll tick failed: ${errorMessage(error)}`);
        this.publishEngineStatus(watcher, 'degraded', 'error');
      }
    } finally {
      this.tickInFlight = false;
    }
  }

  /** Stops every engine; watchers auto-restart on the next tick post-reset. */
  private windDownForGuard(): void {
    for (const watcher of this.watchers.values()) {
      // Degrade every watcher whose INTENDED state is running — including one that
      // is transiently engine-null (a deal re-derive swap carried its prior
      // 'active' status but its drip restart hasn't fired yet, D-dw-20). Without
      // this, a guard trip landing in that window would freeze a lying 'active'
      // for the whole lockout while detection is actually dead (review S2).
      const intendedRunning = watcher.row.enabled && watcher.row.archivedAt === null;
      if (watcher.wsEngine || watcher.pollEngine || intendedRunning) {
        this.stopEngines(watcher);
        this.publishEngineStatus(watcher, 'degraded', 'guard-halted');
      }
    }
  }

  /**
   * Start every enabled-but-not-yet-running watcher — ONE AT A TIME with a
   * DETECTION_STAGGER_MS gap between each. Enabling detection (or a post-guard
   * restart) with N searches otherwise fires N ws-connects in a burst and trips
   * the per-minute connect latch; dripping the starts out keeps it under the
   * ceiling. Fire-and-forget: callers (bootstrap / scheduler tick / resume)
   * return immediately while the starts drip. Re-entrancy is guarded — a tick or
   * resume that fires mid-drip is a no-op, so the same watcher is never
   * double-started; watchers that become pending during the drip are picked up
   * by the next tick.
   */
  private startPendingWatchers(): void {
    if (this.detectionPaused || this.startingWatchers) return;
    const pending = [...this.watchers.values()].filter(
      (watcher) =>
        watcher.row.enabled &&
        this.roomEnabled(watcher) &&
        watcher.row.archivedAt === null &&
        watcher.wsEngine === null &&
        watcher.pollEngine === null &&
        watcher.status !== 'stopped',
    );
    if (pending.length === 0) return;
    this.startingWatchers = true;
    void this.startWatchersStaggered(pending).finally(() => {
      this.startingWatchers = false;
    });
  }

  /**
   * Gap between staggered watcher starts: at least DETECTION_STAGGER_MS, but
   * never faster than the guard's ws-connect budget allows. Each start is a ws
   * connect that counts against GUARD_MAX_WS_CONNECTS_PER_MINUTE — dripping at
   * 500ms (120/min) against the default 12/min ceiling would let a single
   * 13+-search enable (room master switch, global resume, bootstrap) trip the
   * guard by itself. The headroom factor leaves ~1/6 of the budget for organic
   * reconnect churn sharing the same window.
   */
  private detectionStaggerGapMs(): number {
    const guardSafeGapMs = Math.ceil(
      (GUARD_WINDOW_MS / this.config.GUARD_MAX_WS_CONNECTS_PER_MINUTE) *
        GUARD_STAGGER_HEADROOM_FACTOR,
    );
    return Math.max(this.config.DETECTION_STAGGER_MS, guardSafeGapMs);
  }

  private async startWatchersStaggered(pending: Watcher[]): Promise<void> {
    for (let index = 0; index < pending.length; index += 1) {
      const watcher = pending[index]!;
      // A gap is real elapsed time — re-check under current state: the watcher may
      // have been paused, removed/re-pointed, stopped, or already started since the
      // snapshot was taken.
      if (this.detectionPaused) return;
      if (this.watchers.get(watcher.row.id) !== watcher) continue;
      if (
        !watcher.row.enabled ||
        watcher.wsEngine !== null ||
        watcher.pollEngine !== null ||
        watcher.status === 'stopped'
      ) {
        continue;
      }
      this.startWatcher(watcher);
      if (index < pending.length - 1) {
        await sleep(this.detectionStaggerGapMs());
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
    watcher.wsRateLimited = false;
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
      watcher.wsRateLimited = false;
      this.stopPollCoverage(watcher);
      this.publishEngineStatus(watcher, 'active', detail);
      return;
    }
    // connecting / degraded — ws is not serving; poll must cover the gap.
    const wasRateLimited = watcher.wsRateLimited;
    watcher.wsConnected = false;
    watcher.wsRateLimited = detail === WS_RATE_LIMITED_DETAIL;
    if (!watcher.pollEngine && watcher.row.enabled) {
      const { query } = applyPurchaseMode(watcher.row.filters, watcher.row.purchaseMode);
      this.startPollCoverage(watcher, {
        search: this.toRef(watcher.row),
        query,
        correlationId: watcher.correlationId,
      });
    }
    // Publish when: no poll (ws owns the display), OR entering the 1013 wait (surface
    // it over poll), OR just LEFT the 1013 wait — clear the stale message even though
    // poll still covers, since poll emits no status on steady ticks so nothing else
    // would refresh the display.
    if (!watcher.pollEngine || watcher.wsRateLimited || wasRateLimited) {
      this.publishEngineStatus(watcher, status, detail);
    }
  }

  private onPollStatus(watcher: Watcher, status: EngineStatus, detail: string | null): void {
    // ws push wins the display when connected; ignore poll chatter then.
    if (watcher.wsConnected) return;
    // During the WS 1013 wait, keep showing "waiting to reconnect; detecting via poll"
    // ONLY while poll is actually healthy — let a poll degradation/stop through so a
    // real coverage gap surfaces instead of hiding behind the reassuring message.
    if (watcher.wsRateLimited && status === 'active') {
      this.publishEngineStatus(watcher, 'degraded', WS_RATE_LIMITED_DETAIL);
      return;
    }
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
    // Group by OFFER identity via the single authority (LiveOfferRegistry): GGG re-serves
    // the same offer under fresh ids across poll cycles / ws↔poll handoffs (esp. right
    // after a travel re-queries). A NEW offer is a real hit (stored once + auto-travel/buy
    // act); the SAME offer re-served under a NEW id is an UPDATE (feed moves it to the top,
    // NO re-action — auto-travel/buy ignore `hit-updated`); a same-id re-serve drops.
    const fresh: Listing[] = [];
    const updated: Listing[] = [];
    for (const listing of listings) {
      const outcome = this.offerRegistry.ingest(listing);
      if (outcome === 'new') fresh.push(listing);
      else if (outcome === 'updated') updated.push(listing);
    }
    // New offers: one transaction (better-sqlite3 is synchronous) → a single commit/fsync
    // per burst, and no partial DB state if a row throws mid-loop (PERF-4).
    if (fresh.length > 0) {
      // Decorations are computed BEFORE the insert so their columns (the deal
      // JSON) land in the same transaction as the hit row (plan 41, D-dw-5).
      const decorations = new Map(
        fresh.map((listing) => [listing.listingId, this.hitDecorators.decorate(listing)]),
      );
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
              deal: decorations.get(listing.listingId)?.hitColumns?.deal ?? null,
            })
            .run();
        }
      });
      // Bookkeeping + domain events only after the writes commit.
      this.everReceivedHit = true;
      for (const listing of fresh) {
        watcher.hitCount += 1;
        watcher.lastHitAt = listing.detectedAt;
        this.hitsSincePrune += 1;
        const decoration = decorations.get(listing.listingId) ?? null;
        // Suppressed = persisted but silent (deal sub-threshold, D-dw-5).
        if (decoration?.suppressAlert) continue;
        this.realtimeBus.publish(decoration ? decoration.event : { type: 'hit', listing });
        // autoTravel / autoBuy: the Travel + Buy services consume hit/deal/travel events.
      }
      if (this.hitsSincePrune >= PRUNE_EVERY_HITS) {
        this.hitsSincePrune = 0;
        this.pruneHits();
      }
    }
    // Re-served offers (new id, already-known offer): refresh the feed only — the web
    // folds it onto the existing entity and moves it to the top. No DB row, no re-action.
    for (const listing of updated) {
      watcher.lastHitAt = listing.detectedAt;
      const decoration = this.hitDecorators.decorate(listing);
      if (decoration?.suppressAlert) continue;
      this.realtimeBus.publish(
        decoration ? decoration.updatedEvent : { type: 'hit-updated', listing },
      );
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

  private requireRoom(roomId: string): RoomState {
    const room = this.rooms.get(roomId);
    if (!room) throw new NotFoundException(`room ${roomId} does not exist`);
    return room;
  }

  /** Current flattened order + membership, as the layout algebra consumes it.
   *  ACTIVE searches only — archived ones live outside the layout (#35). */
  private layoutSearchStates(): LayoutSearchState[] {
    return [...this.watchers.values()]
      .filter((watcher) => watcher.row.archivedAt === null)
      .map((watcher) => ({
        id: watcher.row.id,
        roomId: watcher.row.roomId,
      }));
  }

  private currentLayout(): SearchLayoutEntry[] {
    return buildLayout(
      this.layoutSearchStates(),
      [...this.rooms.values()].map((room) => ({ id: room.id, position: room.position })),
    );
  }

  /**
   * Persist a canonical layout: one shared 0..N-1 sequence over the top level
   * (rooms + ungrouped searches), 0..M within each room, membership included.
   * Callers wrap this in their transaction so structural changes land atomically.
   */
  private persistLayout(tx: Pick<SniperDatabase, 'update'>, layout: SearchLayoutEntry[]): void {
    layout.forEach((entry, topLevelIndex) => {
      if (entry.kind === 'search') {
        tx.update(searches)
          .set({ position: topLevelIndex, roomId: null })
          .where(eq(searches.id, entry.id))
          .run();
        return;
      }
      tx.update(rooms).set({ position: topLevelIndex }).where(eq(rooms.id, entry.id)).run();
      entry.searchIds.forEach((memberId, memberIndex) => {
        tx.update(searches)
          .set({ position: memberIndex, roomId: entry.id })
          .where(eq(searches.id, memberId))
          .run();
      });
    });
  }

  /** Rebuild the watchers Map (flattened order + membership) and room order from a layout. */
  private applyLayoutToMemory(layout: SearchLayoutEntry[], flattened: LayoutSearchState[]): void {
    const currentWatchers = new Map(this.watchers);
    this.watchers.clear();
    for (const state of flattened) {
      const watcher = currentWatchers.get(state.id);
      if (!watcher) continue;
      watcher.row = { ...watcher.row, roomId: state.roomId };
      this.watchers.set(state.id, watcher);
    }
    // Archived watchers live outside the layout (#35) — re-append them in their
    // previous relative order so a reorder never drops them from the Map.
    for (const [watcherId, watcher] of currentWatchers) {
      if (!this.watchers.has(watcherId)) this.watchers.set(watcherId, watcher);
    }
    const currentRooms = new Map(this.rooms);
    this.rooms.clear();
    for (const entry of layout) {
      if (entry.kind !== 'room') continue;
      const room = currentRooms.get(entry.id);
      if (room) this.rooms.set(entry.id, room);
    }
    this.syncRoomPositions(layout);
  }

  /** Refresh each room's remembered top-level index (the empty-room anchor). */
  private syncRoomPositions(layout: SearchLayoutEntry[]): void {
    layout.forEach((entry, topLevelIndex) => {
      if (entry.kind !== 'room') return;
      const room = this.rooms.get(entry.id);
      if (room) room.position = topLevelIndex;
    });
  }

  /** DB rows in flattened canonical order (bootstrap) — see onApplicationBootstrap.
   *  Archived rows live outside the layout and append at the end (#35). */
  private rowsInFlattenedOrder(): Array<typeof searches.$inferSelect> {
    const allRows = this.database.select().from(searches).all();
    const rows = allRows.filter((row) => row.archivedAt === null);
    const archivedRows = allRows
      .filter((row) => row.archivedAt !== null)
      .sort((first, second) => first.archivedAt!.localeCompare(second.archivedAt!));
    interface ScopedToken {
      position: number;
      addedAt: string;
      rows: Array<typeof searches.$inferSelect>;
    }
    const byScope = (first: ScopedToken, second: ScopedToken): number =>
      first.position - second.position || first.addedAt.localeCompare(second.addedAt);
    const memberTokensByRoom = new Map<string, ScopedToken[]>();
    const topLevelTokens: ScopedToken[] = [];
    for (const row of rows) {
      const token: ScopedToken = {
        position: row.position ?? Number.MAX_SAFE_INTEGER,
        addedAt: row.addedAt,
        rows: [row],
      };
      const roomId = row.roomId !== null && this.rooms.has(row.roomId) ? row.roomId : null;
      if (roomId === null) {
        topLevelTokens.push(token);
      } else {
        memberTokensByRoom.set(roomId, [...(memberTokensByRoom.get(roomId) ?? []), token]);
      }
    }
    for (const room of this.rooms.values()) {
      const memberTokens = (memberTokensByRoom.get(room.id) ?? []).sort(byScope);
      topLevelTokens.push({
        position: room.position,
        addedAt: room.addedAt,
        rows: memberTokens.flatMap((token) => token.rows),
      });
    }
    return [...topLevelTokens.sort(byScope).flatMap((token) => token.rows), ...archivedRows];
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

  private createWatcher(
    row: ManagedSearch,
    marketPrice: MarketPriceSnapshot | null = null,
  ): Watcher {
    const archived = row.archivedAt !== null;
    return {
      row,
      wsEngine: null,
      pollEngine: null,
      wsConnected: false,
      wsRateLimited: false,
      status: row.enabled && !archived ? 'pending' : 'stopped',
      statusDetail: archived ? 'archived' : row.enabled ? null : 'paused',
      correlationId: randomUUID(),
      hitCount: 0,
      lastHitAt: null,
      marketPrice,
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
      // A stale membership (room row gone) self-heals to top-level.
      roomId: row.roomId !== null && this.rooms.has(row.roomId) ? row.roomId : null,
      archivedAt: row.archivedAt,
      dealWatch: this.readDealWatchColumn(row.id, row.dealWatch),
    };
  }

  /** Contract-validated deal_watch read (review F11): malformed JSON → ordinary search + warn. */
  private readDealWatchColumn(searchId: string, value: unknown): DealWatchState | null {
    if (value === null || value === undefined) return null;
    const state = parseDealWatchState(value);
    if (state === null) {
      this.logger.warn(`search ${searchId}: malformed deal_watch state ignored`);
    }
    return state;
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
      marketPrice: this.composeMarketPrice(watcher),
    };
  }

  /** Deal rows serve their live baseline; ordinary rows the hourly snapshot (D-dw-14). */
  private composeMarketPrice(watcher: Watcher): MarketPriceSnapshot | null {
    const dealWatch = watcher.row.dealWatch;
    if (dealWatch !== null) {
      if (dealWatch.baseline === null) return null;
      return {
        baseline: dealWatch.baseline,
        divinePriceExalted: dealWatch.divinePriceExalted,
        nextCheckAt: dealWatch.nextRefreshAt,
      };
    }
    return watcher.marketPrice;
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
