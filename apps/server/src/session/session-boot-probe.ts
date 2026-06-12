import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { TradeApiClient } from '../trade-api/trade-api.client.js';
import { SessionService } from './session.service.js';

/** Probe-delay so boot isn't blocked and engines/UI come up first. */
const BOOT_PROBE_DELAY_MS = 3_000;

/**
 * One /my-account probe shortly after boot when a session exists — the status
 * bar and SessionBanner know immediately whether the stored cookies still
 * work instead of waiting for the first failing engine call.
 */
@Injectable()
export class SessionBootProbe implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SessionBootProbe.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SessionService) private readonly sessionService: SessionService,
    @Inject(TradeApiClient) private readonly tradeApi: TradeApiClient,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.APP_ENV === 'test') return;
    if (!this.sessionService.getSession()) return;
    this.timer = setTimeout(() => {
      this.tradeApi
        .probeMyAccount(randomUUID())
        .then((loggedIn) =>
          this.logger.log(`boot session probe: ${loggedIn ? 'valid' : 'INVALID'}`),
        )
        .catch((error: unknown) => this.logger.warn(`boot session probe failed: ${String(error)}`));
    }, BOOT_PROBE_DELAY_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearTimeout(this.timer);
  }
}
