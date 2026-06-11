import { describe, expect, it, vi } from 'vitest';
import type { DomainEvent } from '@poe-sniper/shared';
import { RealtimeBus } from './realtime-bus.js';

const logEvent: DomainEvent = {
  type: 'log',
  level: 'info',
  message: 'test',
  correlationId: null,
  at: '2026-06-12T10:00:00.000Z',
};

describe('RealtimeBus', () => {
  it('delivers events to all subscribers', () => {
    const bus = new RealtimeBus();
    const first = vi.fn();
    const second = vi.fn();
    bus.subscribe(first);
    bus.subscribe(second);

    bus.publish(logEvent);

    expect(first).toHaveBeenCalledWith(logEvent);
    expect(second).toHaveBeenCalledWith(logEvent);
  });

  it('stops delivering after unsubscribe', () => {
    const bus = new RealtimeBus();
    const subscriber = vi.fn();
    const unsubscribe = bus.subscribe(subscriber);

    unsubscribe();
    bus.publish(logEvent);

    expect(subscriber).not.toHaveBeenCalled();
    expect(bus.subscriberCount).toBe(0);
  });

  it('isolates a throwing subscriber from its peers', () => {
    const bus = new RealtimeBus();
    const throwing = vi.fn(() => {
      throw new Error('boom');
    });
    const healthy = vi.fn();
    bus.subscribe(throwing);
    bus.subscribe(healthy);

    expect(() => bus.publish(logEvent)).not.toThrow();
    expect(healthy).toHaveBeenCalledWith(logEvent);
  });
});
