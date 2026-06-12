import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { NetworkLogEntry } from '@poe-sniper/shared';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { RealtimeBus } from '../events/realtime-bus.js';

const LOG_FILE = 'network.log.jsonl';

/**
 * The one sink for observable GGG traffic. Every call from TradeApiClient and
 * WsEngine records a REDACTED entry here, which fans out to: a bounded in-memory
 * ring (the dev view's initial load), a live `network` event on the bus (SSE),
 * and an appended JSONL line on disk (so an end user can share a log for
 * debugging even with the dev view hidden).
 *
 * Redaction is the callers' contract — this service NEVER sees a cookie, a
 * User-Agent or a hideout token; it only stores what it is given.
 */
@Injectable()
export class NetworkLog {
  private readonly logger = new Logger(NetworkLog.name);
  private readonly ring: NetworkLogEntry[] = [];
  private readonly filePath: string;
  private fileBroken = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(RealtimeBus) private readonly realtimeBus: RealtimeBus,
  ) {
    this.filePath = join(this.config.LOG_DIR, LOG_FILE);
    try {
      mkdirSync(this.config.LOG_DIR, { recursive: true });
    } catch (error) {
      this.fileBroken = true;
      this.logger.warn(`network log dir unavailable (${String(error)}) — file logging disabled`);
    }
  }

  /** Record one interaction; id is assigned here, everything else is caller-built. */
  record(partial: Omit<NetworkLogEntry, 'id'>): void {
    const entry: NetworkLogEntry = { id: randomUUID(), ...partial };
    this.ring.push(entry);
    if (this.ring.length > this.config.NETWORK_LOG_RING_SIZE) this.ring.shift();
    this.realtimeBus.publish({ type: 'network', entry });
    this.appendToFile(entry);
  }

  /** Newest-last snapshot for the dev view's initial load. */
  recent(): NetworkLogEntry[] {
    return [...this.ring];
  }

  /** Absolute path of the shareable log file (shown in the dev view). */
  logFilePath(): string {
    return this.filePath;
  }

  private appendToFile(entry: NetworkLogEntry): void {
    if (this.fileBroken) return;
    try {
      this.rotateIfNeeded();
      appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`);
    } catch (error) {
      // Never let logging break the request path — disable and move on.
      this.fileBroken = true;
      this.logger.warn(`network log write failed (${String(error)}) — file logging disabled`);
    }
  }

  /** Keep one rotated generation (`*.1`) once the live file passes the cap. */
  private rotateIfNeeded(): void {
    if (!existsSync(this.filePath)) return;
    if (statSync(this.filePath).size < this.config.LOG_MAX_BYTES) return;
    renameSync(this.filePath, `${this.filePath}.1`);
  }
}
