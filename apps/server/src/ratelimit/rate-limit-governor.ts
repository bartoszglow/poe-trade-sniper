import { Inject, Injectable, Logger } from '@nestjs/common';
import { clampAggressiveness } from '@poe-sniper/shared';
import { AppSettingsService } from '../settings/app-settings.service.js';
import {
  isNearLimit,
  parseRateLimitHeaders,
  type RateLimitSnapshot,
} from './rate-limit-headers.js';

export interface GovernorStatus {
  pausedUntil: string | null;
  policies: Record<string, RateLimitSnapshot>;
}

/**
 * The single per-IP budget gate. Every outbound GGG call must pass through
 * `acquire()` with its policy key (search / fetch / whisper have separate
 * budgets) and report its response via `noteResponse()`.
 *
 * - spacing: per-policy minimum gap between requests (caller supplies it from
 *   config — the governor itself hardcodes nothing).
 * - 429: pauses ALL policies for Retry-After (lockouts stack on retry).
 * - near-limit: a bucket at our EFFECTIVE ceiling (GGG's cap scaled by the
 *   `rateLimitAggressiveness` setting, D-dw-19) holds that policy for the
 *   bucket's period. GGG's advertised caps are learned live from headers and
 *   never hardcoded; the setting only scales how close to them we run.
 */
@Injectable()
export class RateLimitGovernor {
  private readonly logger = new Logger(RateLimitGovernor.name);
  private globalPauseUntilMs = 0;
  private readonly policyNextSlotMs = new Map<string, number>();
  private readonly policySnapshots = new Map<string, RateLimitSnapshot>();

  // Explicit @Inject: tsx/esbuild emits no decorator metadata. AppSettingsService
  // is @Global, so this is a one-way dependency (governor → settings), no cycle.
  constructor(@Inject(AppSettingsService) private readonly settings: AppSettingsService) {}

  /** Live aggressiveness (% of GGG's advertised limits) — read per evaluation
   *  so a Settings change applies immediately, no restart (D-dw-19). Fail-closed
   *  clamped: a corrupt persisted value must never disarm the governor (S2). */
  private aggressiveness(): number {
    return clampAggressiveness(this.settings.get().rateLimitAggressiveness);
  }

  /** Resolves when it is safe to fire a request under the given policy. */
  async acquire(policyKey: string, minSpacingMs: number): Promise<void> {
    // Loop: the global pause can move while we sleep for a policy slot.
    for (;;) {
      const now = Date.now();
      const slot = Math.max(
        now,
        this.globalPauseUntilMs,
        this.policyNextSlotMs.get(policyKey) ?? 0,
      );
      this.policyNextSlotMs.set(policyKey, slot + minSpacingMs);
      const waitMs = slot - now;
      if (waitMs <= 0) return;
      // Reaction-time instrumentation: a non-zero wait is spacing/pause latency on a
      // (possibly hot-path) call — surfacing it quantifies burst serialization.
      this.logger.debug(`${policyKey}: waiting ${waitMs}ms for slot`);
      await sleep(waitMs);
      if (Date.now() >= slot) return;
    }
  }

  /** Feed every GGG response back so live header data steers the budget. */
  noteResponse(policyKey: string, status: number, headers: Headers): void {
    const snapshot = parseRateLimitHeaders(headers);
    if (snapshot) {
      this.policySnapshots.set(policyKey, snapshot);
      const crowdedRule = isNearLimit(snapshot, this.aggressiveness());
      if (crowdedRule) {
        const holdMs = crowdedRule.periodSeconds * 1000;
        const nextSlot = Date.now() + holdMs;
        this.policyNextSlotMs.set(
          policyKey,
          Math.max(this.policyNextSlotMs.get(policyKey) ?? 0, nextSlot),
        );
        this.logger.warn(
          `${policyKey}: bucket near cap (${crowdedRule.maxHits}/${crowdedRule.periodSeconds}s) — holding ${holdMs / 1000}s`,
        );
      }
    }
    if (status === 429) {
      // Retry-After may be absent, an HTTP-date (Cloudflare fronts pathofexile.com),
      // or otherwise malformed. Any non-finite/non-positive value would NaN-disarm
      // the pause (Math.max(x, NaN) = NaN → status never > now) and corrupt policy
      // slots — so fail CLOSED to a 60s lockout.
      const headerValue = headers.get('retry-after');
      const parsed = headerValue === null ? Number.NaN : Number(headerValue);
      const retryAfterSeconds = Number.isFinite(parsed) && parsed > 0 ? parsed : 60;
      this.pauseAll(retryAfterSeconds);
    }
  }

  /** 429 ⇒ everything stops; retrying into a lockout stacks it. */
  pauseAll(retryAfterSeconds: number): void {
    const until = Date.now() + retryAfterSeconds * 1000;
    this.globalPauseUntilMs = Math.max(this.globalPauseUntilMs, until);
    this.logger.warn(`rate-limited — ALL outbound paused for ${retryAfterSeconds}s`);
  }

  get status(): GovernorStatus {
    return {
      pausedUntil:
        this.globalPauseUntilMs > Date.now()
          ? new Date(this.globalPauseUntilMs).toISOString()
          : null,
      policies: Object.fromEntries(this.policySnapshots),
    };
  }

  /**
   * Fraction of a policy's TIGHTEST bucket still free (0..1) — read-only, for
   * budget-aware callers like the price checker (#37) and deal-watch (plan 41)
   * that must yield to detection. Computed against our EFFECTIVE ceiling (GGG's
   * cap scaled by the aggressiveness setting, D-dw-19), NOT GGG's raw cap, so
   * the reserves (D-dw-18) mean "keep X% of what we're willing to use free".
   * 1 with no observed headers yet (nothing spent), 0 while globally paused.
   * Never changes throttle behaviour — status only.
   */
  headroom(policyKey: string): number {
    if (this.globalPauseUntilMs > Date.now()) return 0;
    const snapshot = this.policySnapshots.get(policyKey);
    if (!snapshot) return 1;
    const aggressiveness = this.aggressiveness();
    let tightest = 1;
    for (let index = 0; index < snapshot.rules.length; index += 1) {
      const rule = snapshot.rules[index];
      const state = snapshot.states[index];
      if (!rule || !state || rule.maxHits <= 0) continue;
      // Continuous (unrounded) effective ceiling for a smooth fraction; the
      // discrete hold decision uses the integer effectiveCap() separately.
      const effectiveCeiling = (rule.maxHits * aggressiveness) / 100;
      const free = Math.max(0, Math.min(1, (effectiveCeiling - state.maxHits) / effectiveCeiling));
      tightest = Math.min(tightest, free);
    }
    return tightest;
  }

  /**
   * The tightest headroom across several policies — the shared budget-gate
   * primitive (D-pc-2, reused by deal-watch per plan 41): a feature that
   * spends one slot from EACH listed policy (a price check or a baseline
   * refresh does search + fetch) must reserve against the most constrained
   * of them. 1 for an empty key list / all-unobserved policies; 0 while
   * globally paused (inherited from headroom()). Status only — never throttles.
   */
  minHeadroom(policyKeys: readonly string[]): number {
    let tightest = 1;
    for (const policyKey of policyKeys) {
      tightest = Math.min(tightest, this.headroom(policyKey));
    }
    return tightest;
  }
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, durationMs));
}
