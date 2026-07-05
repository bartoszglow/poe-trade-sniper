import { describe, expect, it } from 'vitest';
import { type AppSettings, DEFAULT_APP_SETTINGS, type DomainEvent } from '@poe-sniper/shared';
import { loadConfig } from '../config/env.js';
import { RealtimeBus } from '../events/realtime-bus.js';
import type { AppSettingsService } from '../settings/app-settings.service.js';
import { OutboundGuard } from './outbound-guard.js';

function stubSettings(rateLimitAggressiveness = DEFAULT_APP_SETTINGS.rateLimitAggressiveness) {
  const settings: AppSettings = { ...DEFAULT_APP_SETTINGS, rateLimitAggressiveness };
  return { get: () => settings } as unknown as AppSettingsService;
}

function createGuard(httpCeiling = 10, wsCeiling = 2, aggressiveness?: number) {
  const config = loadConfig({
    GUARD_MAX_HTTP_PER_MINUTE: String(httpCeiling),
    GUARD_MAX_WS_CONNECTS_PER_MINUTE: String(wsCeiling),
  });
  const realtimeBus = new RealtimeBus();
  const guardEvents: DomainEvent[] = [];
  realtimeBus.subscribe((event) => {
    if (event.type === 'guard') guardEvents.push(event);
  });
  return {
    guard: new OutboundGuard(config, realtimeBus, stubSettings(aggressiveness)),
    guardEvents,
  };
}

describe('OutboundGuard', () => {
  it('allows traffic under the ceiling', () => {
    const { guard } = createGuard(10);
    for (let index = 0; index < 10; index += 1) {
      expect(guard.allowHttp(`req ${index}`)).toBe(true);
    }
    expect(guard.tripped).toBe(false);
  });

  it('trips on the request over the ceiling and publishes the event', () => {
    const { guard, guardEvents } = createGuard(10);
    for (let index = 0; index < 10; index += 1) guard.allowHttp(`req ${index}`);

    expect(guard.allowHttp('the one too many')).toBe(false);
    expect(guard.tripped).toBe(true);
    expect(guard.status().reason).toContain('HTTP rate');
    expect(guardEvents).toHaveLength(1);
    expect(guardEvents[0]).toMatchObject({ type: 'guard', state: 'tripped' });
  });

  it('refuses everything while tripped — including the other category', () => {
    const { guard } = createGuard(10, 3);
    for (let index = 0; index < 11; index += 1) guard.allowHttp(`req ${index}`); // trips
    expect(guard.tripped).toBe(true);
    expect(guard.allowWsConnect('probe x')).toBe(false);
    expect(guard.allowHttp('still blocked')).toBe(false);
  });

  it('ws connects have their own ceiling', () => {
    const { guard } = createGuard(100, 2);
    expect(guard.allowWsConnect('a')).toBe(true);
    expect(guard.allowWsConnect('b')).toBe(true);
    expect(guard.allowWsConnect('c')).toBe(false);
    expect(guard.status().reason).toContain('ws-connect');
  });

  it('the HTTP ceiling scales UP in the aggressiveness risk zone; ws does NOT (D-dw-19)', () => {
    // base 10, A=120 → effective HTTP ceiling round(10*1.2)=12; the ws ceiling
    // (concurrent-socket constraint, D-dw-8) stays at its base of 2.
    const { guard } = createGuard(10, 2, 120);
    for (let index = 0; index < 12; index += 1) {
      expect(guard.allowHttp(`req ${index}`)).toBe(true); // 12 allowed, not 10
    }
    expect(guard.allowHttp('the 13th')).toBe(false);
    expect(guard.tripped).toBe(true);
  });

  it('the HTTP ceiling never tightens below its base in the safe band (A<=100)', () => {
    // A=85 must NOT drop the tripwire to 8/min (round(10*0.85)) — that would trip
    // spuriously; the base is the floor for 50–100%.
    const { guard } = createGuard(10, 2, 85);
    for (let index = 0; index < 10; index += 1) {
      expect(guard.allowHttp(`req ${index}`)).toBe(true);
    }
    expect(guard.allowHttp('the 11th')).toBe(false);
  });

  it('reset re-arms and publishes the reset event', () => {
    const { guard, guardEvents } = createGuard(10);
    for (let index = 0; index < 11; index += 1) guard.allowHttp(`req ${index}`); // trips
    expect(guard.tripped).toBe(true);

    guard.reset();
    expect(guard.tripped).toBe(false);
    expect(guard.allowHttp('after reset')).toBe(true);
    expect(guardEvents.map((event) => (event as { state: string }).state)).toEqual([
      'tripped',
      'reset',
    ]);
  });
});
