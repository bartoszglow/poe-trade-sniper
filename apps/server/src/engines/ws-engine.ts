import { Logger } from '@nestjs/common';
import WebSocket from 'ws';
import type { NetworkOutcome, SessionState } from '@poe-sniper/shared';
import type { AppConfig } from '../config/env.js';
import type { NetworkLog } from '../network/network-log.service.js';
import type { TradeApiClient, TradeSearchRef } from '../trade-api/trade-api.client.js';
import type { DetectionEngine, EngineCallbacks, EngineContext } from './detection-engine.js';
import { parseLiveMessage, reconnectDelayForClose } from './live-message.js';

type WsConfig = Pick<
  AppConfig,
  | 'POE_BASE_URL'
  | 'WS_HANDSHAKE_TIMEOUT_MS'
  | 'WS_RECONNECT_LADDER_MS'
  | 'WS_STABLE_CONNECTION_MS'
  | 'MAX_FRESH_IDS_PER_TICK'
>;

/** The slice of the safety guard the engine needs (kept narrow for tests). */
export interface WsConnectGate {
  allowWsConnect(detail: string): boolean;
}

export function liveWebSocketUrl(baseUrl: string, search: TradeSearchRef): string {
  return `${baseUrl.replace(/^http/, 'ws')}/api/trade2/live/${search.realm}/${encodeURIComponent(search.league)}/${search.searchId}`;
}

function socketHeaders(session: SessionState): Record<string, string> {
  const cookieHeader = Object.entries(session.cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
  return {
    Cookie: cookieHeader,
    'User-Agent': session.userAgent,
    Origin: 'https://www.pathofexile.com',
  };
}

/**
 * Push detection over the trade2 live websocket — one persistent connection
 * per search, mimicking a single browser trade tab. It NEVER gives up: every
 * close (including 1013 "Try Again Later") just schedules a reconnect on the
 * backoff ladder, resetting only after a stable connection. The SearchManager
 * runs a poll engine alongside it to cover the reconnect gaps, so there is no
 * detection hole and no connection churn that would trip GGG's 1013 backoff.
 */
export class WsEngine implements DetectionEngine {
  readonly kind = 'ws';

  private readonly logger = new Logger(WsEngine.name);
  private socket: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  /** Backoff ladder index — reset after a connection proves stable. */
  private reconnectAttempt = 0;
  /** When the current connection opened — gates the ladder reset. */
  private connectedAtMs = 0;
  private stopped = false;
  private context: EngineContext | null = null;
  private callbacks: EngineCallbacks | null = null;

  constructor(
    private readonly config: WsConfig,
    private readonly tradeApi: Pick<TradeApiClient, 'fetchListings'>,
    private readonly sessionProvider: () => SessionState | null,
    private readonly connectGate: WsConnectGate,
    private readonly networkLog: Pick<NetworkLog, 'record'>,
  ) {}

  start(context: EngineContext, callbacks: EngineCallbacks): void {
    this.context = context;
    this.callbacks = callbacks;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.terminate();
    this.socket = null;
    this.callbacks?.onStatus('stopped', null);
  }

  private connect(): void {
    if (this.stopped || !this.context || !this.callbacks) return;
    const session = this.sessionProvider();
    if (!session) {
      // Keep retrying — the session may load shortly after boot (boot probe).
      // Poll coverage in the SearchManager handles detection meanwhile.
      this.callbacks.onStatus('degraded', 'no session for live websocket');
      this.recordWs('ws-closed', null, 'no session — retrying');
      this.scheduleReconnect(this.config.WS_RECONNECT_LADDER_MS[0] ?? 1_000);
      return;
    }
    if (!this.connectGate.allowWsConnect(this.context.search.searchId)) {
      // No retry timer on purpose: the guard stays tripped until the operator
      // resets it; the SearchManager restarts engines afterwards.
      this.callbacks.onStatus('degraded', 'safety guard tripped — ws connections halted');
      this.recordWs('ws-closed', null, 'safety guard tripped');
      return;
    }

    this.callbacks.onStatus('connecting', null);
    this.recordWs('ws-connecting', null, null);
    const socket = new WebSocket(liveWebSocketUrl(this.config.POE_BASE_URL, this.context.search), {
      headers: socketHeaders(session),
      handshakeTimeout: this.config.WS_HANDSHAKE_TIMEOUT_MS,
    });
    this.socket = socket;

    socket.on('open', () => {
      // Don't reset the ladder yet: a connect→instant-drop loop would otherwise
      // hammer the fastest rung. The reset happens on close, only if stable.
      this.connectedAtMs = Date.now();
      this.callbacks?.onStatus('active', 'live websocket connected');
      this.recordWs('ws-open', null, null);
      // No client-initiated keepalive ping. A real browser CANNOT send ws ping
      // frames (the WebSocket JS API exposes no ping), so GGG's live endpoint
      // treats a client ping as a protocol/policy violation and closes with
      // 1008 — which is exactly what killed every connection at the 30s ping
      // mark. We mimic the browser: stay silent and let `ws` auto-pong GGG's
      // server-side pings, which is what keeps the connection alive.
    });

    socket.on('message', (data: Buffer) => {
      // Defense-in-depth: handleMessage fetches + normalizes live listings, so
      // an unexpected throw must never become an unhandled rejection that kills
      // the process. Per-listing failures are already isolated in fetchListings.
      this.handleMessage(data.toString()).catch((error: unknown) => {
        this.logger.warn(
          `[${this.context?.correlationId}] live message handling failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    });

    socket.on('error', (error: Error) => {
      this.logger.warn(`[${this.context?.correlationId}] socket error: ${error.message}`);
    });

    socket.on('close', (code: number) => {
      if (this.stopped) return;
      const wasStable =
        this.connectedAtMs > 0 &&
        Date.now() - this.connectedAtMs >= this.config.WS_STABLE_CONNECTION_MS;
      this.connectedAtMs = 0;
      if (wasStable) this.reconnectAttempt = 0;

      // Persistent reconnect — never give up (1013 just goes to the top rung).
      // The close code is the diagnostic: 1006 = dropped without handshake
      // (typical GGG periodic drop), 1013 = server says back off, 1000 = clean.
      const delayMs = reconnectDelayForClose(
        code,
        this.config.WS_RECONNECT_LADDER_MS,
        this.reconnectAttempt,
      );
      this.reconnectAttempt += 1;
      this.callbacks?.onStatus(
        'degraded',
        `live connection lost (code ${code}) — reconnecting in ${delayMs / 1000}s`,
      );
      this.recordWs('ws-closed', code, `reconnecting in ${delayMs / 1000}s`);
      this.scheduleReconnect(delayMs);
    });
  }

  private recordWs(outcome: NetworkOutcome, status: number | null, detail: string | null): void {
    if (!this.context) return;
    this.networkLog.record({
      at: new Date().toISOString(),
      channel: 'ws',
      method: 'WS',
      url: liveWebSocketUrl(this.config.POE_BASE_URL, this.context.search),
      policy: 'live',
      correlationId: this.context.correlationId,
      status,
      durationMs: null,
      outcome,
      detail,
      rateLimit: null,
    });
  }

  private scheduleReconnect(delayMs: number): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), delayMs);
  }

  private async handleMessage(text: string): Promise<void> {
    if (!this.context || !this.callbacks) return;
    // Record every raw frame for Network-view visibility: GGG sends an
    // {"auth":true} ack on connect and then {"new":[ids]} batches. Logging the
    // raw payload makes "connected but silent" diagnosable (no auth = no feed).
    this.recordWs('ws-frame', null, text.slice(0, 200));
    const newIds = parseLiveMessage(text);
    if (!newIds) return;
    const idsToFetch = newIds.slice(0, this.config.MAX_FRESH_IDS_PER_TICK);
    const listings = await this.tradeApi.fetchListings(
      this.context.search,
      idsToFetch,
      this.context.correlationId,
    );
    if (!this.stopped && listings.length > 0) {
      this.callbacks.onListings(listings);
    }
  }
}
