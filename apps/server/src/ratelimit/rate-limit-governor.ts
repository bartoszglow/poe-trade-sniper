import { Injectable, Logger } from '@nestjs/common';
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
 * - near-limit: a bucket at cap-1 holds that policy for the bucket's period.
 */
@Injectable()
export class RateLimitGovernor {
  private readonly logger = new Logger(RateLimitGovernor.name);
  private globalPauseUntilMs = 0;
  private readonly policyNextSlotMs = new Map<string, number>();
  private readonly policySnapshots = new Map<string, RateLimitSnapshot>();

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
      await sleep(waitMs);
      if (Date.now() >= slot) return;
    }
  }

  /** Feed every GGG response back so live header data steers the budget. */
  noteResponse(policyKey: string, status: number, headers: Headers): void {
    const snapshot = parseRateLimitHeaders(headers);
    if (snapshot) {
      this.policySnapshots.set(policyKey, snapshot);
      const crowdedRule = isNearLimit(snapshot);
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
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, durationMs));
}
