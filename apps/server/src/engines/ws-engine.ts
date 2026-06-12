import { Logger } from '@nestjs/common';
import WebSocket from 'ws';
import type { SessionState } from '@poe-sniper/shared';
import type { AppConfig } from '../config/env.js';
import type { TradeApiClient, TradeSearchRef } from '../trade-api/trade-api.client.js';
import type { DetectionEngine, EngineCallbacks, EngineContext } from './detection-engine.js';
import { parseLiveMessage } from './live-message.js';

type WsConfig = Pick<
  AppConfig,
  | 'POE_BASE_URL'
  | 'WS_HANDSHAKE_TIMEOUT_MS'
  | 'WS_RECONNECT_LADDER_MS'
  | 'WS_STABLE_CONNECTION_MS'
  | 'WS_KEEPALIVE_PING_MS'
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
 * Handshake probe used to pick ws over poll. MUST carry session cookies and a
 * timeout: GGG tarpits unauthenticated handshakes (they hang forever), and the
 * live backend has been 504-ing since ~patch 0.5.0 (api-notes).
 */
export function probeLiveWebSocket(
  config: WsConfig,
  search: TradeSearchRef,
  session: SessionState,
): Promise<boolean> {
  return new Promise((resolveProbe) => {
    const socket = new WebSocket(liveWebSocketUrl(config.POE_BASE_URL, search), {
      headers: socketHeaders(session),
      handshakeTimeout: config.WS_HANDSHAKE_TIMEOUT_MS,
    });
    socket.on('open', () => {
      socket.close();
      resolveProbe(true);
    });
    socket.on('error', () => resolveProbe(false));
    socket.on('unexpected-response', () => {
      socket.terminate();
      resolveProbe(false);
    });
  });
}

/**
 * Push detection over the trade2 live websocket — near-zero latency when
 * GGG's backend is up. Reconnects with exponential backoff (aggressive
 * reconnects burn the shared IP budget).
 */
export class WsEngine implements DetectionEngine {
  readonly kind = 'ws';

  private readonly logger = new Logger(WsEngine.name);
  private socket: WebSocket | null = null;
  private keepaliveTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  /** When the current connection opened — distinguishes routine vs unstable drops. */
  private connectedAtMs = 0;
  private stopped = false;
  private context: EngineContext | null = null;
  private callbacks: EngineCallbacks | null = null;

  constructor(
    private readonly config: WsConfig,
    private readonly tradeApi: Pick<TradeApiClient, 'fetchListings'>,
    private readonly sessionProvider: () => SessionState | null,
    private readonly connectGate: WsConnectGate,
  ) {}

  start(context: EngineContext, callbacks: EngineCallbacks): void {
    this.context = context;
    this.callbacks = callbacks;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.keepaliveTimer = null;
    this.reconnectTimer = null;
    this.socket?.terminate();
    this.socket = null;
    this.callbacks?.onStatus('stopped', null);
  }

  private connect(): void {
    if (this.stopped || !this.context || !this.callbacks) return;
    const session = this.sessionProvider();
    if (!session) {
      this.callbacks.onStatus('degraded', 'no session for live websocket');
      return;
    }
    if (!this.connectGate.allowWsConnect(this.context.search.searchId)) {
      // No retry timer on purpose: the guard stays tripped until the operator
      // resets it; the SearchManager restarts engines afterwards.
      this.callbacks.onStatus('degraded', 'safety guard tripped — ws connections halted');
      return;
    }

    this.callbacks.onStatus('connecting', null);
    const socket = new WebSocket(liveWebSocketUrl(this.config.POE_BASE_URL, this.context.search), {
      headers: socketHeaders(session),
      handshakeTimeout: this.config.WS_HANDSHAKE_TIMEOUT_MS,
    });
    this.socket = socket;

    socket.on('open', () => {
      this.connectedAtMs = Date.now();
      this.callbacks?.onStatus('active', 'live websocket connected');
      this.keepaliveTimer = setInterval(() => socket.ping(), this.config.WS_KEEPALIVE_PING_MS);
    });

    socket.on('message', (data: Buffer) => {
      void this.handleMessage(data.toString());
    });

    socket.on('error', (error: Error) => {
      this.logger.warn(`[${this.context?.correlationId}] socket error: ${error.message}`);
    });

    socket.on('close', (code: number) => {
      if (this.keepaliveTimer) clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
      if (this.stopped) return;
      const wasStable =
        this.connectedAtMs > 0 &&
        Date.now() - this.connectedAtMs >= this.config.WS_STABLE_CONNECTION_MS;
      this.connectedAtMs = 0;

      // 1013 = "Try Again Later" (server says back off), or a drop before the
      // connection proved stable = GGG's live backend cooling off. Either way
      // DON'T sit dark on a reconnect ladder — hand the search straight back to
      // poll so detection keeps running at a safe cadence. The SearchManager's
      // shared, background live-backend monitor re-promotes every search at
      // once when a single probe confirms ws is up again.
      if (code === 1013 || !wasStable) {
        this.callbacks?.onDemote(`unstable ws (close code ${code})`);
        return;
      }

      // A connection that ran stable then dropped is a routine periodic GGG
      // drop — exactly what the real client silently reconnects from. One
      // quick reconnect; if THAT proves unstable the branch above demotes us.
      const delayMs = this.config.WS_RECONNECT_LADDER_MS[0] ?? 1_000;
      this.callbacks?.onStatus(
        'degraded',
        `live connection lost (code ${code}) — reconnecting in ${delayMs / 1000}s`,
      );
      this.reconnectTimer = setTimeout(() => this.connect(), delayMs);
    });
  }

  private async handleMessage(text: string): Promise<void> {
    if (!this.context || !this.callbacks) return;
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
