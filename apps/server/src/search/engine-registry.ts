import type { EngineKind } from '@poe-sniper/shared';
import type { AppConfig } from '../config/env.js';
import type { DetectionEngine } from '../engines/detection-engine.js';
import { PollEngine } from '../engines/poll-engine.js';
import { WsEngine } from '../engines/ws-engine.js';
import type { OutboundGuard } from '../guard/outbound-guard.js';
import type { SessionService } from '../session/session.service.js';
import type { TradeApiClient } from '../trade-api/trade-api.client.js';

export interface EngineFactory {
  kind: EngineKind;
  create(): DetectionEngine;
}

export const ENGINE_REGISTRY = Symbol('ENGINE_REGISTRY');

/**
 * The engine registry — the open/closed seam of detection. The SearchManager
 * composes a persistent `ws` engine (one socket per search) with `poll` as the
 * gap/cold fallback; adding a strategy = appending a factory here.
 */
export function buildEngineRegistry(
  config: AppConfig,
  tradeApi: TradeApiClient,
  sessionService: SessionService,
  guard: OutboundGuard,
): EngineFactory[] {
  return [
    {
      kind: 'ws',
      create: () => new WsEngine(config, tradeApi, () => sessionService.getSession(), guard),
    },
    {
      kind: 'poll',
      create: () => new PollEngine(config, tradeApi),
    },
  ];
}
