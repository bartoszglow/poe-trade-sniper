import type { EngineKind } from '@poe-sniper/shared';
import type { AppConfig } from '../config/env.js';
import type { DetectionEngine } from '../engines/detection-engine.js';
import { PollEngine } from '../engines/poll-engine.js';
import { probeLiveWebSocket, WsEngine } from '../engines/ws-engine.js';
import type { SessionService } from '../session/session.service.js';
import type { TradeApiClient, TradeSearchRef } from '../trade-api/trade-api.client.js';

export interface EngineFactory {
  kind: EngineKind;
  /** Can this engine serve the search right now? */
  probe(search: TradeSearchRef): Promise<boolean>;
  create(): DetectionEngine;
}

export const ENGINE_REGISTRY = Symbol('ENGINE_REGISTRY');

/**
 * The ordered engine registry — the open/closed seam of detection. The
 * SearchManager walks it and picks the first factory whose probe passes;
 * adding a strategy = appending an entry, nothing else changes. Poll sits
 * last as the always-available fallback.
 */
export function buildEngineRegistry(
  config: AppConfig,
  tradeApi: TradeApiClient,
  sessionService: SessionService,
): EngineFactory[] {
  return [
    {
      kind: 'ws',
      probe: (search) => {
        const session = sessionService.getSession();
        if (!session) return Promise.resolve(false);
        return probeLiveWebSocket(config, search, session);
      },
      create: () => new WsEngine(config, tradeApi, () => sessionService.getSession()),
    },
    {
      kind: 'poll',
      probe: () => Promise.resolve(true),
      create: () => new PollEngine(config, tradeApi),
    },
  ];
}
