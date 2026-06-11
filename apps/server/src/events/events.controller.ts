import { Controller, Inject, MessageEvent, Sse } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { DomainEvent } from '@poe-sniper/shared';
import { RealtimeBus } from './realtime-bus.js';

/** Non-domain keepalive frame so proxies don't reap idle connections. */
interface HeartbeatFrame {
  type: 'heartbeat';
}

const HEARTBEAT_INTERVAL_MS = 25_000;

@Controller('events')
export class EventsController {
  constructor(@Inject(RealtimeBus) private readonly realtimeBus: RealtimeBus) {}

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
