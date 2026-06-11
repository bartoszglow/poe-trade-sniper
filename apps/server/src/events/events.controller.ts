import { Controller, Inject, MessageEvent, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { DomainEvent } from '@poe-sniper/shared';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { RealtimeBus } from './realtime-bus.js';

/** Non-domain keepalive frame so proxies don't reap idle connections. */
interface HeartbeatFrame {
  type: 'heartbeat';
}

const HEARTBEAT_INTERVAL_MS = 25_000;

@Controller('events')
export class EventsController {
  constructor(
    private readonly realtimeBus: RealtimeBus,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Sse()
  stream(): Observable<MessageEvent> {
    return new Observable<MessageEvent>((observer) => {
      const unsubscribe = this.realtimeBus.subscribe((event: DomainEvent) => {
        observer.next({ data: event });
      });
      const heartbeat = setInterval(() => {
        const frame: HeartbeatFrame = { type: 'heartbeat' };
        observer.next({ data: frame });
      }, HEARTBEAT_INTERVAL_MS);

      return () => {
        unsubscribe();
        clearInterval(heartbeat);
      };
    });
  }
}
