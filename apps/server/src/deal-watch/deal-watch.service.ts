import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { notInArray, sql } from 'drizzle-orm';
import type {
  DealBaselineHistoryEntry,
  DealWatchMode,
  DealWatchState,
  DealWatchUnit,
  ManagedSearch,
  SearchRuntimeInfo,
} from '@poe-sniper/shared';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DATABASE } from '../db/db.module.js';
import type { SniperDatabase } from '../db/migrate.js';
import { dealBaselineHistory } from '../db/schema.js';
import { OutboundGuard } from '../guard/outbound-guard.js';
import { TradeDataService } from '../price-check/trade-data.service.js';
import { RateLimitGovernor } from '../ratelimit/rate-limit-governor.js';
import { HitDecoratorRegistry } from '../search/hit-decorator.js';
import { SearchManager } from '../search/search-manager.js';
import { TradeApiClient, TradeApiError } from '../trade-api/trade-api.client.js';
import { DealBaselineService, type BaselineComputation } from './deal-baseline.service.js';
import { DealHistoryService } from './deal-history.service.js';
import { DealHitDecorator, type DealRuntimeSnapshot } from './deal-hit.decorator.js';
import {
  computeCutoffExalted,
  restoreQuery,
  stripPriceFilter,
  withPriceCap,
} from './deal-query.js';
import { stackableCategoryFor } from './stackable-gate.js';

/** Operator-editable deal config (the PATCH payload subset). */
export interface DealWatchConfigInput {
  mode: DealWatchMode;
  thresholdValue: number;
  unit: DealWatchUnit;
  /** D-dw-15 sample-size knob — validated 3..20 at the controller edge. */
  baselineSampleSize: number;
}

export type ManualRefreshResult =
  | { kind: 'ok'; info: SearchRuntimeInfo }
  | { kind: 'cooldown'; retryInMs: number }
  /** Refresh not possible in the row's current state — explicit code, no silent no-op. */
  | { kind: 'declined'; code: 'archived' | 'disabled' | 'paused' | 'guard-tripped' };

interface DealJob {
  watchId: string;
  /** True forces a re-derive regardless of drift (threshold edit, expiry, import). */
  forceRederive: boolean;
  /** True = this job completes a disable (restore + clear) under the queue's serialization. */
  disable: boolean;
  /** True = the enable was seeded from a fresh market snapshot (D-dw-14) —
   *  skip the baseline GGG spend when the seeded baseline is still fresh. */
  reuseBaseline: boolean;
  settlers: Array<() => void>;
}

/** GGG-spending policies a deal op draws on — the headroom reserve gate (D-pc-2 posture). */
const DEAL_POLICIES = ['search', 'fetch'] as const;

/**
 * Backoff fraction of the refresh interval after a declined/failed cycle
 * (budget-low, 429, non-429 GGG error). A GGG outage must not turn the queue
 * beat into a retry storm, and budget-low must not wait a full hour either
 * (review F4/F26).
 */
const REFRESH_BACKOFF_RATIO = 0.25;

/**
 * Deal-watch orchestrator (plan 41): owns enable/disable transforms, the
 * hourly-ish baseline refresh loop, and the serialized re-derive queue. All
 * GGG traffic flows through TradeApiClient (hard rule #4); every watcher
 * restart rides the SearchManager stagger drip (D-dw-8). One job runs at a
 * time process-wide, with post-await revalidation (the startWatchersStaggered
 * posture) so concurrent triggers can never double-derive or orphan a row.
 * While detection is paused or the guard is tripped the queue declines work
 * and SETTLES its awaiters (review F1) — a request handler never hangs on it.
 */
@Injectable()
export class DealWatchService
  implements OnModuleInit, OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(DealWatchService.name);
  /** Sync per-watch state for the hot-path decorator, keyed by stable watchId. */
  private readonly snapshots = new Map<string, DealRuntimeSnapshot>();
  /** Pending jobs keyed by watchId — a second trigger coalesces (flags OR-merge). */
  private readonly pendingJobs = new Map<string, DealJob>();
  private readonly rederiveDebounceTimers = new Map<string, NodeJS.Timeout>();
  private readonly lastManualRefreshAtMs = new Map<string, number>();
  /** Final search id per completed disable — lets the request path locate the restored row. */
  private readonly disableResults = new Map<string, string>();
  private queueTimer: NodeJS.Timeout | null = null;
  private queueRunning = false;
  private shuttingDown = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly database: SniperDatabase,
    @Inject(SearchManager) private readonly searchManager: SearchManager,
    @Inject(TradeApiClient) private readonly tradeApi: TradeApiClient,
    @Inject(OutboundGuard) private readonly guard: OutboundGuard,
    @Inject(RateLimitGovernor) private readonly governor: RateLimitGovernor,
    @Inject(HitDecoratorRegistry) private readonly hitDecorators: HitDecoratorRegistry,
    @Inject(DealBaselineService) private readonly baselineService: DealBaselineService,
    @Inject(DealHistoryService) private readonly historyService: DealHistoryService,
    @Inject(TradeDataService) private readonly tradeData: TradeDataService,
  ) {}

  onModuleInit(): void {
    this.hitDecorators.register(
      new DealHitDecorator(
        (searchId) => this.searchManager.getRow(searchId),
        (searchId) => this.snapshotForSearch(searchId),
        this.config.DEAL_BASELINE_STALE_MS,
      ),
    );
    // Narrow cleanup seam (review F2): a deal row deleted via remove()/import-
    // replace tears down its runtime maps + history without an event round-trip.
    this.searchManager.setDealRowCleanup((watchId) => this.forgetWatch(watchId));
  }

  onApplicationBootstrap(): void {
    this.reconcileOrphanHistory();
    // DEAL_MAX_WATCHES holds on EVERY path that arms watches (review F3): rows
    // beyond the cap — e.g. after a large import or a lowered cap — are parked
    // as `capped` (never derived/refreshed) instead of silently armed. Only
    // enabled, non-archived rows consume cap slots (review F27).
    let armedCount = 0;
    for (const row of this.searchManager.dealModeRows()) {
      const state = row.dealWatch;
      if (state === null) continue;
      this.seedSnapshot(state);
      const consumesSlot =
        row.enabled && row.archivedAt === null && state.status !== 'unsupported-item';
      if (consumesSlot && armedCount >= this.config.DEAL_MAX_WATCHES) {
        if (state.status !== 'capped') {
          this.searchManager.updateDealState(row.id, { ...state, status: 'capped' });
        }
        continue;
      }
      if (consumesSlot) armedCount += 1;
      if (state.status === 'capped') {
        // A slot opened up (cap raised / other watches gone) — resume deriving.
        this.searchManager.updateDealState(row.id, {
          ...state,
          status: state.baseline === null ? 'pending-derive' : 'active',
        });
      }
      if (state.status === 'pending-derive' || state.status === 'derived-expired') {
        this.enqueue(state.watchId, { forceRederive: true });
      }
      if (state.status === 'restore-pending') {
        this.enqueue(state.watchId, { disable: true });
      }
    }
    this.queueTimer = setInterval(() => {
      // The beat must survive any single bad row (review F15).
      try {
        this.scanDueRefreshes();
        void this.runQueue();
      } catch (error) {
        this.logger.warn(`deal queue beat failed: ${String(error)}`);
      }
    }, this.config.DEAL_QUEUE_TICK_MS);
  }

  onApplicationShutdown(): void {
    this.shuttingDown = true;
    if (this.queueTimer) clearInterval(this.queueTimer);
    this.queueTimer = null;
    for (const timer of this.rederiveDebounceTimers.values()) clearTimeout(timer);
    this.rederiveDebounceTimers.clear();
    this.settleAllPending();
  }

  // -------------------------------------------------------------------------
  // Operator API (controller-facing)
  // -------------------------------------------------------------------------

  /** Enable deal mode, edit its config, or disable (null). */
  async applyConfig(
    searchId: string,
    configInput: DealWatchConfigInput | null,
  ): Promise<SearchRuntimeInfo> {
    const row = this.requireRow(searchId);
    if (configInput === null) return this.disable(row);
    return row.dealWatch === null
      ? this.enable(row, configInput)
      : this.editConfig(row, configInput);
  }

  /** Operator-triggered baseline re-check (cooldown-gated, joins a running job). */
  async manualRefresh(searchId: string): Promise<ManualRefreshResult> {
    const row = this.requireRow(searchId);
    const state = this.requireDealState(row);
    // Explicit declines BEFORE the cooldown stamp (review F22/F1): a refresh on
    // a row that cannot refresh must say so, not burn the cooldown or hang.
    if (row.archivedAt !== null) return { kind: 'declined', code: 'archived' };
    if (!row.enabled) return { kind: 'declined', code: 'disabled' };
    if (this.guard.tripped) return { kind: 'declined', code: 'guard-tripped' };
    if (this.searchManager.isDetectionGloballyPaused()) {
      return { kind: 'declined', code: 'paused' };
    }
    const lastAtMs = this.lastManualRefreshAtMs.get(state.watchId) ?? 0;
    const sinceMs = Date.now() - lastAtMs;
    if (sinceMs < this.config.DEAL_MANUAL_REFRESH_COOLDOWN_MS) {
      return {
        kind: 'cooldown',
        retryInMs: this.config.DEAL_MANUAL_REFRESH_COOLDOWN_MS - sinceMs,
      };
    }
    this.lastManualRefreshAtMs.set(state.watchId, Date.now());
    await this.enqueueAndWait(state.watchId, {});
    const current = this.rowByWatchId(state.watchId) ?? row;
    return { kind: 'ok', info: this.runtimeInfo(current.id) };
  }

  /** Newest-first baseline history for the trend view (D-dw-12). */
  history(searchId: string, limit: number): DealBaselineHistoryEntry[] {
    const row = this.requireRow(searchId);
    const state = this.requireDealState(row);
    return this.historyService.recent(state.watchId, limit);
  }

  // -------------------------------------------------------------------------
  // Enable / edit / disable transforms
  // -------------------------------------------------------------------------

  private async enable(
    row: ManagedSearch,
    configInput: DealWatchConfigInput,
  ): Promise<SearchRuntimeInfo> {
    // `unsupported-item` rows never derive, never spend budget and never open a
    // socket — they must not consume cap slots (review P2-9), or ten refused
    // enables would block every further watch behind a misleading cap 409.
    const activeWatches = this.searchManager
      .dealModeRows()
      .filter(
        (dealRow) =>
          dealRow.enabled &&
          dealRow.archivedAt === null &&
          dealRow.dealWatch?.status !== 'unsupported-item',
      ).length;
    if (activeWatches >= this.config.DEAL_MAX_WATCHES) {
      // Coded body — the web maps it to i18n; raw prose never crosses the wire
      // (error-audit rule; review P2-2).
      throw new ConflictException({ code: 'deal-capped' });
    }
    const { definition, originalPriceFilter } = stripPriceFilter(row.filters);
    const state: DealWatchState = {
      watchId: randomUUID(),
      mode: configInput.mode,
      thresholdValue: configInput.thresholdValue,
      unit: configInput.unit,
      baselineSampleSize: configInput.baselineSampleSize,
      definition,
      originalSearchId: row.id,
      originalPriceFilter,
      baseline: null,
      capBaseline: null,
      capExalted: null,
      derivedCreatedAt: null,
      status: 'pending-derive',
      nextRefreshAt: null,
      divinePriceExalted: null,
    };
    // W3 stackable gate (plan 41 v1 scope): stack-priced categories have no
    // per-unit price handling, so a baseline over mixed stack sizes would be
    // silently garbage. Refused BEFORE any baseline compute: the state persists
    // as `unsupported-item` (never derived — the row keeps watching its
    // original query under its original id) and the PATCH answers 409.
    const stackableCategory = await this.stackableCategoryFor(state.definition);
    if (stackableCategory !== null) {
      this.searchManager.updateDealState(row.id, { ...state, status: 'unsupported-item' });
      this.seedSnapshot(state);
      this.logger.warn(
        `deal enable refused for ${row.id}: stack-priced category '${stackableCategory}'`,
      );
      throw new ConflictException({ code: 'deal-unsupported-item' });
    }
    // A fresh hourly market snapshot (D-dw-14) seeds the baseline for free —
    // the first derive then skips its GGG spend. The snapshot column clears:
    // the deal baseline owns display from here on.
    const marketSnapshot = this.searchManager.getMarketSnapshot(row.id);
    const reuseBaseline =
      marketSnapshot !== null &&
      Date.now() - Date.parse(marketSnapshot.baseline.computedAt) <=
        this.config.MARKET_SNAPSHOT_REUSE_MS;
    if (reuseBaseline) {
      state.baseline = marketSnapshot.baseline;
      state.divinePriceExalted = marketSnapshot.divinePriceExalted;
    }
    this.searchManager.updateMarketSnapshot(row.id, null);
    // Persist FIRST so the operator sees pending-derive even if the first
    // derive is slow/declined; the row still watches its original query until
    // the swap lands (the decorator treats pre-derive rows as ordinary). Under
    // pause/guard the queue settles immediately and this state IS the answer.
    this.searchManager.updateDealState(row.id, state);
    this.seedSnapshot(state);
    await this.enqueueAndWait(state.watchId, { forceRederive: true, reuseBaseline });
    const current = this.rowByWatchId(state.watchId) ?? row;
    return this.runtimeInfo(current.id);
  }

  private editConfig(row: ManagedSearch, configInput: DealWatchConfigInput): SearchRuntimeInfo {
    const state = this.requireDealState(row);
    // An edit cancels a not-yet-run disable — last operator intent wins.
    const pendingJob = this.pendingJobs.get(state.watchId);
    if (pendingJob?.disable && pendingJob.settlers.length === 0) {
      this.pendingJobs.delete(state.watchId);
    }
    const nextState: DealWatchState = {
      ...state,
      mode: configInput.mode,
      thresholdValue: configInput.thresholdValue,
      unit: configInput.unit,
      // A sample-size change is picked up by the NEXT scheduled refresh — it
      // must not force an immediate GGG spend (D-dw-15).
      baselineSampleSize: configInput.baselineSampleSize,
      status:
        state.status === 'restore-pending'
          ? state.baseline === null
            ? 'pending-derive'
            : 'active'
          : state.status,
    };
    const info = this.searchManager.updateDealState(row.id, nextState);
    this.refreshSnapshotCutoff(nextState);
    // Debounced re-derive: rapid threshold edits coalesce into one swap.
    const existingTimer = this.rederiveDebounceTimers.get(state.watchId);
    if (existingTimer) clearTimeout(existingTimer);
    this.rederiveDebounceTimers.set(
      state.watchId,
      setTimeout(() => {
        this.rederiveDebounceTimers.delete(state.watchId);
        this.enqueue(state.watchId, { forceRederive: true });
        void this.runQueue();
      }, this.config.DEAL_REDERIVE_DEBOUNCE_MS),
    );
    return info;
  }

  /**
   * Disable runs THROUGH the serialized queue (review F6): the restore spends
   * GGG budget and races in-flight re-derives otherwise. While paused/tripped
   * the row parks as `restore-pending` and the queue completes the restore on
   * resume — operator pause means zero GGG traffic (review F14).
   */
  private async disable(row: ManagedSearch): Promise<SearchRuntimeInfo> {
    const state = this.requireDealState(row);
    // Never derived → the row still watches the original query under the
    // original id; clearing the state is the whole disable (no GGG).
    if (state.derivedCreatedAt === null) {
      const info = this.searchManager.updateDealState(row.id, null);
      this.forgetWatch(state.watchId);
      return info;
    }
    if (this.guard.tripped || this.searchManager.isDetectionGloballyPaused()) {
      this.searchManager.updateDealState(row.id, { ...state, status: 'restore-pending' });
      this.enqueue(state.watchId, { disable: true });
      return this.runtimeInfo(row.id);
    }
    await this.enqueueAndWait(state.watchId, { disable: true });
    const restoredSearchId = this.disableResults.get(state.watchId);
    this.disableResults.delete(state.watchId);
    if (restoredSearchId !== undefined) return this.runtimeInfo(restoredSearchId);
    // Restore didn't complete. If the job was declined mid-flight (guard trip /
    // pause between enqueue and run), it is still queued — park the row as
    // restore-pending so the UI shows the truth until the queue resumes it.
    const current = this.rowByWatchId(state.watchId);
    if (
      current !== null &&
      current.dealWatch !== null &&
      this.pendingJobs.get(state.watchId)?.disable
    ) {
      this.searchManager.updateDealState(current.id, {
        ...current.dealWatch,
        status: 'restore-pending',
      });
    }
    return this.runtimeInfo(current?.id ?? row.id);
  }

  /** Prefer the remembered original id; a dead one gets re-minted from the query. */
  private async resolveRestoreTarget(
    row: ManagedSearch,
    state: DealWatchState,
    restored: unknown,
    correlationId: string,
  ): Promise<string> {
    const originalRef = { realm: row.realm, league: row.league, searchId: state.originalSearchId };
    try {
      await this.tradeApi.resolveQuery(originalRef, correlationId);
      return state.originalSearchId;
    } catch (error) {
      if (!(error instanceof TradeApiError) || error.status !== 404) throw error;
    }
    // Original id expired — re-mint from the restored query. Sort matches the
    // trade site's default for a hand-made search (newest first).
    const created = await this.tradeApi.createSearch(
      row.realm,
      row.league,
      { query: restored, sort: { indexed: 'desc' } },
      correlationId,
    );
    if (created.id === null) {
      throw new Error(created.rateLimited ? 'restore rate-limited' : 'restore POST returned no id');
    }
    return created.id;
  }

  // -------------------------------------------------------------------------
  // The serialized job queue (one derive/refresh in flight process-wide)
  // -------------------------------------------------------------------------

  private enqueue(
    watchId: string,
    options: { forceRederive?: boolean; disable?: boolean; reuseBaseline?: boolean },
  ): void {
    const existing = this.pendingJobs.get(watchId);
    if (existing) {
      existing.forceRederive = existing.forceRederive || (options.forceRederive ?? false);
      existing.disable = existing.disable || (options.disable ?? false);
      existing.reuseBaseline = existing.reuseBaseline || (options.reuseBaseline ?? false);
      return;
    }
    this.pendingJobs.set(watchId, {
      watchId,
      forceRederive: options.forceRederive ?? false,
      disable: options.disable ?? false,
      reuseBaseline: options.reuseBaseline ?? false,
      settlers: [],
    });
  }

  private enqueueAndWait(
    watchId: string,
    options: { forceRederive?: boolean; disable?: boolean; reuseBaseline?: boolean },
  ): Promise<void> {
    this.enqueue(watchId, options);
    const job = this.pendingJobs.get(watchId)!;
    const settled = new Promise<void>((resolve) => job.settlers.push(resolve));
    void this.runQueue();
    return settled;
  }

  /** Fire and clear every pending job's settlers — jobs stay queued for later. */
  private settleAllPending(): void {
    for (const job of this.pendingJobs.values()) {
      for (const settle of job.settlers) settle();
      job.settlers = [];
    }
  }

  private async runQueue(): Promise<void> {
    if (this.queueRunning) return;
    this.queueRunning = true;
    try {
      while (!this.shuttingDown) {
        // Deal work yields entirely to a tripped guard or a global pause —
        // operator pause means ZERO GGG traffic, deal-watch included. Awaiters
        // are settled, never left hanging (review F1); the jobs themselves stay
        // queued and run on the next beat after resume.
        if (this.guard.tripped || this.searchManager.isDetectionGloballyPaused()) {
          this.settleAllPending();
          return;
        }
        const nextJob = this.pendingJobs.values().next().value;
        if (!nextJob) return;
        this.pendingJobs.delete(nextJob.watchId);
        try {
          await this.processJob(nextJob);
        } catch (error) {
          this.logger.warn(`deal job for watch ${nextJob.watchId} failed: ${String(error)}`);
        } finally {
          for (const settle of nextJob.settlers) settle();
        }
        if (this.pendingJobs.size > 0) {
          await sleep(this.config.DETECTION_STAGGER_MS);
        }
      }
    } finally {
      this.queueRunning = false;
    }
  }

  private scanDueRefreshes(): void {
    if (this.guard.tripped || this.searchManager.isDetectionGloballyPaused()) return;
    const nowMs = Date.now();
    for (const row of this.searchManager.dealModeRows()) {
      const state = row.dealWatch;
      if (state === null || !row.enabled || row.archivedAt !== null) continue;
      // `capped` rows are parked (no slot); `restore-pending` rows are dying —
      // their disable job is already queued, a refresh would just interleave;
      // `unsupported-item` rows are refused (W3) — a refresh would derive them.
      if (
        state.status === 'capped' ||
        state.status === 'restore-pending' ||
        state.status === 'unsupported-item'
      ) {
        continue;
      }
      if (state.status === 'pending-derive') {
        // A pending derive (declined enable / import) retries on the beat.
        this.enqueue(state.watchId, { forceRederive: true });
        continue;
      }
      const dueAtMs = state.nextRefreshAt === null ? nowMs : Date.parse(state.nextRefreshAt);
      if (dueAtMs <= nowMs) this.enqueue(state.watchId, {});
    }
  }

  private async processJob(job: DealJob): Promise<void> {
    // One correlation id threads every GGG leg of this job (review F16).
    const correlationId = randomUUID();
    if (job.disable) {
      await this.processDisable(job, correlationId);
      return;
    }
    try {
      await this.processRefresh(job, correlationId);
    } catch (error) {
      // A non-429 GGG failure (outage, 5xx, session lapse) must not retry-storm
      // on the queue beat: surface derive-failed and back off (review F4).
      const row = this.rowByWatchId(job.watchId);
      const state = row?.dealWatch ?? null;
      if (row !== null && state !== null) {
        this.updateStateIfCurrent(row.id, {
          ...state,
          status: 'derive-failed',
          nextRefreshAt: this.backoffRefreshAt(),
        });
      }
      this.logger.warn(
        `deal refresh for watch ${job.watchId} failed (${correlationId}): ${String(error)}`,
      );
    }
  }

  /** The disable/restore leg, serialized + revalidated like every other mutation. */
  private async processDisable(job: DealJob, correlationId: string): Promise<void> {
    const row = this.rowByWatchId(job.watchId);
    const state = row?.dealWatch ?? null;
    if (row === null || state === null) return;
    if (state.derivedCreatedAt === null) {
      this.searchManager.updateDealState(row.id, null);
      this.forgetWatch(state.watchId);
      this.disableResults.set(job.watchId, row.id);
      return;
    }
    const restored = restoreQuery(state.definition, state.originalPriceFilter);
    const searchIdAtStart = row.id;
    try {
      const swapTarget = await this.resolveRestoreTarget(row, state, restored, correlationId);
      // Post-await revalidation: the watch may be gone or re-derived meanwhile.
      const currentRow = this.rowByWatchId(job.watchId);
      if (currentRow === null || currentRow.dealWatch === null) return;
      const info = this.searchManager.swapDealSearch(currentRow.id, {
        id: swapTarget,
        filters: restored,
        dealWatch: null,
      });
      // The last deal baseline IS a valid market price — hand it to the
      // universal loop so the row keeps its display for free (D-dw-14); the
      // loop reschedules from its computedAt on discovery.
      if (state.baseline !== null) {
        this.searchManager.updateMarketSnapshot(info.id, {
          baseline: state.baseline,
          divinePriceExalted: state.divinePriceExalted,
          nextCheckAt: null,
        });
      }
      this.forgetWatch(state.watchId);
      this.disableResults.set(job.watchId, info.id);
    } catch (error) {
      const currentRow = this.rowByWatchId(job.watchId);
      const currentState = currentRow?.dealWatch ?? null;
      this.logger.warn(
        `deal disable restore failed for ${searchIdAtStart} (${correlationId}): ${String(error)}`,
      );
      if (currentRow !== null && currentState !== null) {
        this.updateStateIfCurrent(currentRow.id, { ...currentState, status: 'restore-failed' });
      }
    }
  }

  private async processRefresh(job: DealJob, correlationId: string): Promise<void> {
    const row = this.rowByWatchId(job.watchId);
    const state = row?.dealWatch ?? null;
    // Revalidate under CURRENT state — the watch may have been disabled or its
    // search removed while the job sat in the queue.
    if (row === null || state === null) return;
    // W3 gate: a refused stack-priced watch never derives or refreshes — any
    // job reaching it (manual refresh, edit debounce) is a deliberate no-op.
    if (state.status === 'unsupported-item') return;

    const searchIdAtStart = row.id;
    let forceRederive = job.forceRederive;

    // Expiry probe (P0.8): only when ws is down — a connected socket proves the
    // id alive; resolve 404 is the ONLY trustworthy dead-id signal (fetch fails
    // silently with nulls). Budget-gated like every GGG-spending leg (review F13).
    if (
      state.derivedCreatedAt !== null &&
      !this.searchManager.isWsConnected(row.id) &&
      this.governor.minHeadroom([...DEAL_POLICIES]) >= this.config.DEAL_MIN_HEADROOM
    ) {
      try {
        await this.tradeApi.resolveQuery(
          { realm: row.realm, league: row.league, searchId: row.id },
          correlationId,
        );
      } catch (error) {
        if (error instanceof TradeApiError && error.status === 404) {
          this.logger.warn(`derived id ${row.id} expired — recovery re-derive`);
          // Re-read state post-await: the write must not clobber a concurrent
          // threshold edit (review F7).
          const freshRow = this.rowByWatchId(job.watchId);
          const freshState = freshRow?.dealWatch ?? null;
          if (freshRow === null || freshState === null || freshRow.id !== searchIdAtStart) return;
          this.updateStateIfCurrent(searchIdAtStart, { ...freshState, status: 'derived-expired' });
          forceRederive = true;
        } else {
          throw error;
        }
      }
    }

    // Seeded from a fresh market snapshot (D-dw-14): the baseline is already
    // current — skip the GGG spend. The decorator's rate map stays empty until
    // the next scheduled refresh (documented seedSnapshot posture).
    const computation: BaselineComputation =
      job.reuseBaseline &&
      state.baseline !== null &&
      Date.now() - Date.parse(state.baseline.computedAt) <= this.config.MARKET_SNAPSHOT_REUSE_MS
        ? {
            kind: 'ok',
            baseline: state.baseline,
            ratesByApiId: null,
            divinePriceExalted: state.divinePriceExalted,
          }
        : await this.baselineService.computeBaseline(
            state.definition,
            row.realm,
            row.league,
            correlationId,
            state.baselineSampleSize,
          );
    // Post-await revalidation: the world may have moved while we awaited GGG.
    const currentRow = this.rowByWatchId(job.watchId);
    if (currentRow === null || currentRow.id !== searchIdAtStart) return;
    const currentState = currentRow.dealWatch;
    if (currentState === null) return;

    if (computation.kind === 'budget-low' || computation.kind === 'rate-limited') {
      // Declined-by-budget is not a failure: keep the status, retry on a short
      // backoff instead of a full interval (review F26).
      this.updateStateIfCurrent(searchIdAtStart, {
        ...currentState,
        status: this.staleness(currentState) ? 'baseline-stale' : currentState.status,
        nextRefreshAt: this.backoffRefreshAt(),
      });
      return;
    }
    if (computation.kind === 'insufficient') {
      this.updateStateIfCurrent(searchIdAtStart, {
        ...currentState,
        status: 'insufficient-data',
        nextRefreshAt: this.nextRefreshAt(),
        divinePriceExalted: computation.divinePriceExalted,
      });
      this.applySnapshot(currentState, computation);
      return;
    }

    const withNewBaseline: DealWatchState = {
      ...currentState,
      baseline: computation.baseline,
      nextRefreshAt: this.nextRefreshAt(),
      divinePriceExalted: computation.divinePriceExalted,
    };
    const needsRederive =
      forceRederive ||
      withNewBaseline.capBaseline === null ||
      this.driftRatio(
        computation.baseline.amountExalted,
        withNewBaseline.capBaseline.amountExalted,
      ) > this.config.DEAL_DRIFT_THRESHOLD ||
      this.derivedIdAgeMs(withNewBaseline) > this.config.DEAL_MAX_ID_AGE_MS;

    if (!needsRederive) {
      this.updateStateIfCurrent(searchIdAtStart, { ...withNewBaseline, status: 'active' });
      this.applySnapshot(withNewBaseline, computation);
      this.historyService.record(currentState.watchId, computation.baseline, false);
      return;
    }
    const rederived = await this.rederive(
      searchIdAtStart,
      { realm: currentRow.realm, league: currentRow.league },
      withNewBaseline,
      computation,
      correlationId,
    );
    this.historyService.record(currentState.watchId, computation.baseline, rederived);
  }

  /** Returns true when the cap actually moved (a swap or same-id cap update ran). */
  private async rederive(
    searchId: string,
    ref: { realm: string; league: string },
    state: DealWatchState,
    computation: Extract<BaselineComputation, { kind: 'ok' }>,
    correlationId: string,
  ): Promise<boolean> {
    const cutoffExalted = computeCutoffExalted(
      { ...state, baseline: computation.baseline },
      computation.divinePriceExalted,
    );
    if (cutoffExalted === null || cutoffExalted <= 0) {
      // Threshold ≥ baseline (or divine rate missing): no listing can qualify —
      // surfaced as insufficient-data with the fresh baseline kept visible.
      this.updateStateIfCurrent(searchId, { ...state, status: 'insufficient-data' });
      this.applySnapshot(state, computation);
      return false;
    }
    const capExalted = Math.max(
      1,
      Math.round(cutoffExalted * (1 + this.config.DEAL_CAP_MARGIN_RATIO)),
    );
    if (capExalted === state.capExalted && state.status !== 'derived-expired') {
      // Same cap → same content-addressed id; a re-POST is a no-op by evidence
      // (api-notes 2026-07-05). The id counts as re-validated: derivedCreatedAt
      // resets, so the max-id-age invariant means "the cap was confirmed
      // current" — an actual id refresh only happens when the cap moves or the
      // expiry probe flags the id (review F5).
      this.updateStateIfCurrent(searchId, {
        ...state,
        capBaseline: computation.baseline,
        derivedCreatedAt: new Date().toISOString(),
        status: 'active',
      });
      this.applySnapshot({ ...state, capBaseline: computation.baseline }, computation);
      return false;
    }
    // The re-derive POST is a GGG spend of its own — same reserve as the
    // baseline pair (review F13). Declined-by-budget keeps the old cap running.
    if (this.governor.minHeadroom([...DEAL_POLICIES]) < this.config.DEAL_MIN_HEADROOM) {
      this.updateStateIfCurrent(searchId, { ...state, nextRefreshAt: this.backoffRefreshAt() });
      this.applySnapshot(state, computation);
      return false;
    }
    const cappedQuery = withPriceCap(state.definition, capExalted);
    const created = await this.tradeApi.createSearch(
      ref.realm,
      ref.league,
      { query: cappedQuery, sort: { price: 'asc' } },
      correlationId,
    );
    // Revalidate after the POST before touching row state.
    const currentRow = this.rowByWatchId(state.watchId);
    if (currentRow === null || currentRow.id !== searchId || currentRow.dealWatch === null) {
      return false;
    }
    if (created.id === null) {
      this.updateStateIfCurrent(searchId, {
        ...state,
        status: 'derive-failed',
        nextRefreshAt: this.backoffRefreshAt(),
      });
      this.applySnapshot(state, computation);
      return false;
    }
    const nextState: DealWatchState = {
      ...state,
      baseline: computation.baseline,
      capBaseline: computation.baseline,
      capExalted,
      derivedCreatedAt: new Date().toISOString(),
      status: 'active',
    };
    try {
      this.searchManager.swapDealSearch(searchId, {
        id: created.id,
        filters: cappedQuery,
        dealWatch: nextState,
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        this.updateStateIfCurrent(searchId, { ...state, status: 'derive-conflict' });
        this.applySnapshot(state, computation);
        return false;
      }
      throw error;
    }
    this.applySnapshot(nextState, computation);
    this.logger.log(
      `deal re-derive: ${searchId} → ${created.id} (cap ${capExalted}ex, baseline ${computation.baseline.amountExalted.toFixed(1)}ex)`,
    );
    return true;
  }

  // -------------------------------------------------------------------------
  // Snapshots + small helpers
  // -------------------------------------------------------------------------

  /**
   * Resolve the definition's top-level name/type to a stack-priced dictionary
   * category (W3 gate), or null when the item is supported. Offline-tolerant
   * by design: an unavailable dictionary or an unknown name NEVER blocks an
   * enable — the gate is best-effort, the broad-query UI warning is the net.
   */
  private async stackableCategoryFor(definition: unknown): Promise<string | null> {
    return stackableCategoryFor(this.tradeData, definition, (candidate, error) => {
      this.logger.warn(
        `stackable gate skipped for '${candidate}' (dictionary unavailable): ${String(error)}`,
      );
    });
  }

  private snapshotForSearch(searchId: string): DealRuntimeSnapshot | null {
    const watchId = this.searchManager.getRow(searchId)?.dealWatch?.watchId;
    return watchId === undefined ? null : (this.snapshots.get(watchId) ?? null);
  }

  private seedSnapshot(state: DealWatchState): void {
    // Rates arrive with the first baseline compute; until then non-exalted
    // listing prices read as unpriceable (null discounts, never suppressed).
    // The persisted divine rate survives a restart so display conversion and
    // absolute-mode cutoffs don't blank until the next refresh.
    this.snapshots.set(state.watchId, {
      ratesByApiId: null,
      divinePriceExalted: state.divinePriceExalted,
      cutoffExalted: computeCutoffExalted(state, state.divinePriceExalted),
    });
  }

  private applySnapshot(
    state: DealWatchState,
    computation: Extract<BaselineComputation, { kind: 'ok' | 'insufficient' }>,
  ): void {
    this.snapshots.set(state.watchId, {
      ratesByApiId: computation.ratesByApiId,
      divinePriceExalted: computation.divinePriceExalted,
      cutoffExalted:
        computation.kind === 'ok'
          ? computeCutoffExalted(
              { ...state, baseline: computation.baseline },
              computation.divinePriceExalted,
            )
          : null,
    });
  }

  /** Recompute the suppression cutoff after a config edit (rates unchanged). */
  private refreshSnapshotCutoff(state: DealWatchState): void {
    const snapshot = this.snapshots.get(state.watchId);
    if (!snapshot) return;
    this.snapshots.set(state.watchId, {
      ...snapshot,
      cutoffExalted: computeCutoffExalted(state, snapshot.divinePriceExalted),
    });
  }

  private forgetWatch(watchId: string): void {
    this.snapshots.delete(watchId);
    this.pendingJobs.delete(watchId);
    this.lastManualRefreshAtMs.delete(watchId);
    const timer = this.rederiveDebounceTimers.get(watchId);
    if (timer) clearTimeout(timer);
    this.rederiveDebounceTimers.delete(watchId);
    this.historyService.clearForWatch(watchId);
  }

  /** History rows whose watch no longer exists (deleted search etc.) die at boot. */
  private reconcileOrphanHistory(): void {
    const liveWatchIds = this.searchManager
      .dealModeRows()
      .map((row) => row.dealWatch?.watchId)
      .filter((watchId): watchId is string => watchId !== undefined);
    try {
      if (liveWatchIds.length === 0) {
        this.database.run(sql`DELETE FROM deal_baseline_history`);
      } else {
        this.database
          .delete(dealBaselineHistory)
          .where(notInArray(dealBaselineHistory.watchId, liveWatchIds))
          .run();
      }
    } catch (error) {
      this.logger.warn(`orphan history reconcile failed: ${String(error)}`);
    }
  }

  private rowByWatchId(watchId: string): ManagedSearch | null {
    return (
      this.searchManager.dealModeRows().find((row) => row.dealWatch?.watchId === watchId) ?? null
    );
  }

  /** Guarded state write: only lands when the row still exists under that id. */
  private updateStateIfCurrent(searchId: string, state: DealWatchState): void {
    if (this.searchManager.getRow(searchId) === null) return;
    this.searchManager.updateDealState(searchId, state);
  }

  private requireRow(searchId: string): ManagedSearch {
    const row = this.searchManager.getRow(searchId);
    if (row === null) throw new NotFoundException(`search ${searchId} not found`);
    return row;
  }

  private requireDealState(row: ManagedSearch): DealWatchState {
    if (row.dealWatch === null || row.dealWatch === undefined) {
      throw new NotFoundException(`search ${row.id} has no deal watch`);
    }
    return row.dealWatch;
  }

  private runtimeInfo(searchId: string): SearchRuntimeInfo {
    const info = this.searchManager.list().find((candidate) => candidate.id === searchId);
    if (!info) throw new NotFoundException(`search ${searchId} not found`);
    return info;
  }

  private staleness(state: DealWatchState): boolean {
    return (
      state.baseline !== null &&
      Date.now() - Date.parse(state.baseline.computedAt) > this.config.DEAL_BASELINE_STALE_MS
    );
  }

  private driftRatio(newAmount: number, referenceAmount: number): number {
    if (referenceAmount <= 0) return Number.POSITIVE_INFINITY;
    return Math.abs(newAmount - referenceAmount) / referenceAmount;
  }

  private derivedIdAgeMs(state: DealWatchState): number {
    return state.derivedCreatedAt === null ? 0 : Date.now() - Date.parse(state.derivedCreatedAt);
  }

  /** Relative + jittered schedule (R7): the phase random-walks across days. */
  private nextRefreshAt(): string {
    const jitterSpan = this.config.DEAL_REFRESH_INTERVAL_MS * this.config.DEAL_REFRESH_JITTER_RATIO;
    const jitter = (Math.random() * 2 - 1) * jitterSpan;
    return new Date(Date.now() + this.config.DEAL_REFRESH_INTERVAL_MS + jitter).toISOString();
  }

  /** Short retry horizon after a declined/failed cycle (reviews F4/F26). */
  private backoffRefreshAt(): string {
    const baseMs = this.config.DEAL_REFRESH_INTERVAL_MS * REFRESH_BACKOFF_RATIO;
    const jitter = (Math.random() * 2 - 1) * baseMs * this.config.DEAL_REFRESH_JITTER_RATIO;
    return new Date(Date.now() + baseMs + jitter).toISOString();
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
