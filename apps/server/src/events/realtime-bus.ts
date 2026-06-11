import { Injectable, Logger } from '@nestjs/common';
import type { DomainEvent } from '@poe-sniper/shared';

export type RealtimeSubscriber = (event: DomainEvent) => void;

/**
 * Typed in-process pub/sub over the closed DomainEvent union. Producers
 * (engines, SearchManager) publish; the SSE controller subscribes. A throwing
 * subscriber never takes down the publisher or its peers.
 */
@Injectable()
export class RealtimeBus {
  private readonly logger = new Logger(RealtimeBus.name);
  private readonly subscribers = new Set<RealtimeSubscriber>();

  publish(event: DomainEvent): void {
    for (const subscriber of this.subscribers) {
      try {
        subscriber(event);
      } catch (error) {
        this.logger.warn(`subscriber failed on ${event.type}: ${String(error)}`);
      }
    }
  }

  /** Returns the unsubscribe function — callers MUST invoke it on teardown. */
  subscribe(subscriber: RealtimeSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }
}
