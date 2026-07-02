import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { RealtimeBus } from '../events/realtime-bus.js';

export interface GuardStatus {
  tripped: boolean;
  reason: string | null;
  httpInLastMinute: number;
  wsConnectsInLastMinute: number;
}

/** The guard's rolling rate window — exported so pacing code (the detection
 *  stagger drip) can derive a start rate that stays under the ceiling. */
export const GUARD_WINDOW_MS = 60_000;
const WINDOW_MS = GUARD_WINDOW_MS;

/**
 * The runaway watchdog — the last line of defense against banning ourselves.
 *
 * Every outbound GGG action (HTTP request, ws connection attempt) must pass
 * through here. Rolling per-minute counters are checked against hard
 * ceilings; a breach TRIPS the guard: all outbound is refused, engines wind
 * down, a `guard` event reaches the UI. The guard stays tripped until the
 * operator explicitly resets it — a loop that tripped once would trip again.
 */
@Injectable()
export class OutboundGuard {
  private readonly logger = new Logger(OutboundGuard.name);
  private readonly httpTimestamps: number[] = [];
  private readonly wsConnectTimestamps: number[] = [];
  private trippedReason: string | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(RealtimeBus) private readonly realtimeBus: RealtimeBus,
  ) {}

  get tripped(): boolean {
    return this.trippedReason !== null;
  }

  /** Gate for every GGG HTTP request. False = refused (guard tripped). */
  allowHttp(detail: string): boolean {
    return this.allow(this.httpTimestamps, this.config.GUARD_MAX_HTTP_PER_MINUTE, 'HTTP', detail);
  }

  /** Gate for every ws connection attempt (probes included). */
  allowWsConnect(detail: string): boolean {
    return this.allow(
      this.wsConnectTimestamps,
      this.config.GUARD_MAX_WS_CONNECTS_PER_MINUTE,
      'ws-connect',
      detail,
    );
  }

  reset(): GuardStatus {
    if (this.trippedReason !== null) {
      this.trippedReason = null;
      // Fresh windows — otherwise the backlog would re-trip on the next call.
      this.httpTimestamps.length = 0;
      this.wsConnectTimestamps.length = 0;
      this.logger.warn('guard reset by operator — outbound re-armed');
      this.realtimeBus.publish({
        type: 'guard',
        state: 'reset',
        reason: null,
        at: new Date().toISOString(),
      });
    }
    return this.status();
  }

  status(): GuardStatus {
    const cutoff = Date.now() - WINDOW_MS;
    return {
      tripped: this.tripped,
      reason: this.trippedReason,
      httpInLastMinute: this.httpTimestamps.filter((at) => at > cutoff).length,
      wsConnectsInLastMinute: this.wsConnectTimestamps.filter((at) => at > cutoff).length,
    };
  }

  private allow(timestamps: number[], ceiling: number, kind: string, detail: string): boolean {
    if (this.tripped) return false;
    const now = Date.now();
    while (timestamps.length > 0 && timestamps[0]! < now - WINDOW_MS) {
      timestamps.shift();
    }
    timestamps.push(now);
    if (timestamps.length > ceiling) {
      this.trip(
        `${kind} rate ${timestamps.length}/min exceeded the ${ceiling}/min ceiling (last: ${detail})`,
      );
      return false;
    }
    return true;
  }

  private trip(reason: string): void {
    this.trippedReason = reason;
    this.logger.error(`GUARD TRIPPED — all outbound halted: ${reason}`);
    this.realtimeBus.publish({
      type: 'guard',
      state: 'tripped',
      reason,
      at: new Date().toISOString(),
    });
  }
}
