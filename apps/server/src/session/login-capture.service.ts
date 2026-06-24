import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import WebSocket from 'ws';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { errorMessage } from '../util/error-message.js';
import { TradeApiClient } from '../trade-api/trade-api.client.js';
import { SessionService } from './session.service.js';

export type LoginCaptureState = 'idle' | 'waiting-login' | 'success' | 'failed';

export interface LoginCaptureStatus {
  state: LoginCaptureState;
  detail: string | null;
}

interface CdpCookie {
  name: string;
  value: string;
  domain: string;
}

const POLL_INTERVAL_MS = 5_000;
const CAPTURE_TIMEOUT_MS = 5 * 60_000;

/**
 * In-app login for web mode (D-12): launches the user's REAL Chrome with a
 * dedicated profile on the PoE homepage; the user logs in on the genuine GGG
 * page (credentials never touch us). We attach over the DevTools protocol —
 * invisible to page JS, no automation fingerprint — and poll the cookie jar;
 * once a POESESSID set passes the /my-account probe, the session is saved and
 * Chrome is closed.
 */
@Injectable()
export class LoginCaptureService implements OnApplicationShutdown {
  private readonly logger = new Logger(LoginCaptureService.name);
  private state: LoginCaptureState = 'idle';
  private detail: string | null = null;
  private chrome: ChildProcess | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private startedAtMs = 0;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SessionService) private readonly sessionService: SessionService,
    @Inject(TradeApiClient) private readonly tradeApi: TradeApiClient,
  ) {}

  status(): LoginCaptureStatus {
    return { state: this.state, detail: this.detail };
  }

  start(): LoginCaptureStatus {
    if (this.state === 'waiting-login') return this.status();
    this.cleanup();
    this.startedAtMs = Date.now();

    const debugPort = 9222 + Math.floor(Math.random() * 1000);
    const profileDir = join(this.config.LOGIN_PROFILE_DIR, 'chrome-login-profile');
    mkdirSync(profileDir, { recursive: true });

    this.chrome = spawn(
      this.config.CHROME_BINARY,
      [
        `--user-data-dir=${profileDir}`,
        `--remote-debugging-port=${debugPort}`,
        // Bind CDP to loopback explicitly (don't rely on the default): the debug
        // port exposes the cookie jar during the ~5 min login window (SEC-3).
        '--remote-debugging-address=127.0.0.1',
        '--no-first-run',
        '--no-default-browser-check',
        '--new-window',
        this.config.POE_BASE_URL,
      ],
      { stdio: 'ignore' },
    );
    this.chrome.on('error', (error) => this.fail(`cannot launch Chrome: ${error.message}`));
    this.chrome.on('exit', () => {
      if (this.state === 'waiting-login') this.fail('Chrome window was closed before login');
    });

    this.state = 'waiting-login';
    this.detail = 'log in on the Path of Exile page that just opened';
    this.pollTimer = setInterval(() => {
      void this.poll(debugPort).catch((error: unknown) => {
        this.logger.debug(`capture poll: ${errorMessage(error)}`);
      });
    }, POLL_INTERVAL_MS);
    return this.status();
  }

  cancel(): LoginCaptureStatus {
    if (this.state === 'waiting-login') {
      this.state = 'idle';
      this.detail = null;
    }
    this.cleanup();
    return this.status();
  }

  onApplicationShutdown(): void {
    this.cleanup();
  }

  private async poll(debugPort: number): Promise<void> {
    if (Date.now() - this.startedAtMs > CAPTURE_TIMEOUT_MS) {
      this.fail('login capture timed out (5 min)');
      return;
    }

    const version = (await (
      await fetch(`http://127.0.0.1:${debugPort}/json/version`, {
        signal: AbortSignal.timeout(3_000),
      })
    ).json()) as { webSocketDebuggerUrl?: string; 'User-Agent'?: string };
    if (!version.webSocketDebuggerUrl) return;

    const cookies = await this.fetchCookies(version.webSocketDebuggerUrl);
    const poeCookies = cookies.filter((cookie) => cookie.domain.endsWith('pathofexile.com'));
    if (!poeCookies.some((cookie) => cookie.name === 'POESESSID')) return;

    // Guests carry a POESESSID too — only a passing login probe counts.
    const cookieRecord = Object.fromEntries(
      poeCookies.map((cookie) => [cookie.name, cookie.value]),
    );
    this.sessionService.setFromCookies(
      cookieRecord,
      version['User-Agent'] ?? this.config.FALLBACK_USER_AGENT,
    );
    const loggedIn = await this.tradeApi.probeMyAccount(randomUUID());
    if (!loggedIn) return; // not logged in yet — keep waiting

    this.state = 'success';
    this.detail = `captured ${poeCookies.length} cookies — logged in`;
    this.cleanup();
    this.logger.log('login capture succeeded');
  }

  private fetchCookies(debuggerUrl: string): Promise<CdpCookie[]> {
    return new Promise((resolveCookies, rejectCookies) => {
      const socket = new WebSocket(debuggerUrl, { handshakeTimeout: 3_000 });
      const deadline = setTimeout(() => {
        socket.terminate();
        rejectCookies(new Error('CDP cookie read timed out'));
      }, 5_000);
      socket.on('open', () => {
        socket.send(JSON.stringify({ id: 1, method: 'Storage.getCookies' }));
      });
      socket.on('message', (raw: Buffer) => {
        const message = JSON.parse(raw.toString()) as {
          id?: number;
          result?: { cookies?: CdpCookie[] };
        };
        if (message.id === 1) {
          clearTimeout(deadline);
          socket.close();
          resolveCookies(message.result?.cookies ?? []);
        }
      });
      socket.on('error', (error) => {
        clearTimeout(deadline);
        rejectCookies(error);
      });
    });
  }

  private fail(reason: string): void {
    this.state = 'failed';
    this.detail = reason;
    this.cleanup();
    this.logger.warn(`login capture failed: ${reason}`);
  }

  private cleanup(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    if (this.chrome && !this.chrome.killed) {
      this.chrome.removeAllListeners('exit');
      this.chrome.kill();
    }
    this.chrome = null;
  }
}
