import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { ManagedSearch } from '@poe-sniper/shared';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { OutboundGuard } from '../guard/outbound-guard.js';
import { TradeDataService } from '../price-check/trade-data.service.js';
import { SearchManager } from '../search/search-manager.js';
import { DealBaselineService } from './deal-baseline.service.js';
import { stripPriceFilter } from './deal-query.js';
import { stackableCategoryFor } from './stackable-gate.js';

/**
 * First check for a search discovered at RUNTIME (freshly added, deal watch
 * disabled): quick enough that the operator sees a price soon, jittered enough
 * not to fingerprint the add action. Boot discovery staggers across the full
 * interval instead — 19 restarting searches must not burst (D-dw-14).
 */
const RUNTIME_DISCOVERY_MIN_DELAY_MS = 30_000;
const RUNTIME_DISCOVERY_MAX_DELAY_MS = 180_000;

/** Backoff fraction of the interval after budget-low/429 (the deal-loop posture). */
const CHECK_BACKOFF_RATIO = 0.25;

/**
 * Universal market-price loop (plan 41, D-dw-14 — operator decision): every
 * enabled, non-archived, NON-deal search gets an hourly-ish market baseline so
 * the operator always knows what a purchase price compares against. Deal rows
 * are covered by their own refresh loop. Best-effort display data: no status
 * machinery, silent staleness, at most ONE GGG-spending check per beat (the
 * beat self-paces bursts after a pause/guard resume). All spend rides the same
 * headroom reserve as deal refreshes — detection always outranks this work.
 */
@Injectable()
export class MarketPriceService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MarketPriceService.name);
  /** Next check per search id — in-memory; the persisted snapshot mirrors it for display. */
  private readonly nextCheckAtMs = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private checking = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SearchManager) private readonly searchManager: SearchManager,
    @Inject(DealBaselineService) private readonly baselineService: DealBaselineService,
    @Inject(OutboundGuard) private readonly guard: OutboundGuard,
    @Inject(TradeDataService) private readonly tradeData: TradeDataService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.MARKET_CHECK_ENABLED) return;
    // Boot stagger: schedule every candidate uniformly across the first
    // interval unless its persisted snapshot already implies a future check.
    const nowMs = Date.now();
    for (const candidate of this.searchManager.marketCheckCandidates()) {
      const naturalDueMs =
        candidate.snapshot === null
          ? null
          : Date.parse(candidate.snapshot.baseline.computedAt) + this.jitteredIntervalMs();
      const dueMs =
        naturalDueMs !== null && naturalDueMs > nowMs
          ? naturalDueMs
          : nowMs + Math.random() * this.config.MARKET_CHECK_INTERVAL_MS;
      this.nextCheckAtMs.set(candidate.row.id, dueMs);
    }
    this.timer = setInterval(() => {
      try {
        void this.beat();
      } catch (error) {
        this.logger.warn(`market-price beat failed: ${String(error)}`);
      }
    }, this.config.DEAL_QUEUE_TICK_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One beat: reconcile the schedule with live candidates, run at most one due check. */
  private async beat(): Promise<void> {
    if (!this.config.MARKET_CHECK_ENABLED || this.checking) return;
    if (this.guard.tripped || this.searchManager.isDetectionGloballyPaused()) return;
    const candidates = this.searchManager.marketCheckCandidates();
    const liveIds = new Set(candidates.map((candidate) => candidate.row.id));
    // Prune schedules whose row is gone / archived / deal-covered now — the
    // deal-enable path needs no unschedule call, the reconcile IS the cleanup.
    for (const scheduledId of this.nextCheckAtMs.keys()) {
      if (!liveIds.has(scheduledId)) this.nextCheckAtMs.delete(scheduledId);
    }
    const nowMs = Date.now();
    let due: { row: ManagedSearch; dueMs: number } | null = null;
    for (const candidate of candidates) {
      let dueMs = this.nextCheckAtMs.get(candidate.row.id);
      if (dueMs === undefined) {
        // Runtime discovery: a snapshot implies its natural schedule; a brand-new
        // row gets a quick first check (single search — negligible spend).
        dueMs =
          candidate.snapshot !== null
            ? Date.parse(candidate.snapshot.baseline.computedAt) + this.jitteredIntervalMs()
            : nowMs +
              RUNTIME_DISCOVERY_MIN_DELAY_MS +
              Math.random() * (RUNTIME_DISCOVERY_MAX_DELAY_MS - RUNTIME_DISCOVERY_MIN_DELAY_MS);
        this.nextCheckAtMs.set(candidate.row.id, dueMs);
      }
      if (dueMs <= nowMs && (due === null || dueMs < due.dueMs)) {
        due = { row: candidate.row, dueMs };
      }
    }
    if (due === null) return;
    this.checking = true;
    try {
      await this.checkOne(due.row);
    } catch (error) {
      // Best-effort: log, back off, never touch the persisted snapshot.
      this.logger.warn(`market check for ${due.row.id} failed: ${String(error)}`);
      this.scheduleBackoff(due.row.id);
    } finally {
      this.checking = false;
    }
  }

  private async checkOne(row: ManagedSearch): Promise<void> {
    const { definition } = stripPriceFilter(row.filters);
    // Same v1 scope as deal enable (W3): stack-priced items have no per-unit
    // pricing — a whole-stack "market price" would mislead. Skip quietly.
    const stackableCategory = await stackableCategoryFor(this.tradeData, definition, () => {
      // Dictionary unavailable — fail open like the enable gate; no log spam
      // on a beat that fires for every search hourly.
    });
    if (stackableCategory !== null) {
      this.scheduleNext(row.id);
      return;
    }
    const computation = await this.baselineService.computeBaseline(
      definition,
      row.realm,
      row.league,
      // Default correlationId + sample size; the market loop is the LOW-priority
      // tier, so it gates on the higher MARKET reserve — it yields to deal work
      // and detection (D-dw-18).
      undefined,
      undefined,
      this.config.MARKET_CHECK_MIN_HEADROOM,
    );
    if (computation.kind === 'budget-low' || computation.kind === 'rate-limited') {
      this.scheduleBackoff(row.id);
      return;
    }
    if (computation.kind === 'insufficient') {
      // No reliable price — the row shows nothing rather than a made-up number.
      this.searchManager.updateMarketSnapshot(row.id, null);
      this.scheduleNext(row.id);
      return;
    }
    const nextMs = this.scheduleNext(row.id);
    this.searchManager.updateMarketSnapshot(row.id, {
      baseline: computation.baseline,
      divinePriceExalted: computation.divinePriceExalted,
      nextCheckAt: new Date(nextMs).toISOString(),
    });
  }

  private scheduleNext(searchId: string): number {
    const dueMs = Date.now() + this.jitteredIntervalMs();
    this.nextCheckAtMs.set(searchId, dueMs);
    return dueMs;
  }

  private scheduleBackoff(searchId: string): void {
    const baseMs = this.config.MARKET_CHECK_INTERVAL_MS * CHECK_BACKOFF_RATIO;
    const jitter = (Math.random() * 2 - 1) * baseMs * this.config.MARKET_CHECK_JITTER_RATIO;
    this.nextCheckAtMs.set(searchId, Date.now() + baseMs + jitter);
  }

  private jitteredIntervalMs(): number {
    const baseMs = this.config.MARKET_CHECK_INTERVAL_MS;
    const jitter = (Math.random() * 2 - 1) * baseMs * this.config.MARKET_CHECK_JITTER_RATIO;
    return baseMs + jitter;
  }
}
