import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DomainEvent, NetworkLogEntry } from '@poe-sniper/shared';
import { loadConfig } from '../config/env.js';
import { RealtimeBus } from '../events/realtime-bus.js';
import { NetworkLog } from './network-log.service.js';

function entry(overrides: Partial<Omit<NetworkLogEntry, 'id'>> = {}): Omit<NetworkLogEntry, 'id'> {
  return {
    at: '2026-06-12T10:00:00.000Z',
    channel: 'http',
    method: 'GET',
    url: 'https://www.pathofexile.com/api/trade2/search/poe2/Standard/abc',
    policy: 'search',
    correlationId: 'cid',
    status: 200,
    durationMs: 5,
    outcome: 'ok',
    detail: null,
    rateLimit: null,
    ...overrides,
  };
}

function createLog(extra: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'sniper-netlog-'));
  const config = loadConfig({ LOG_DIR: dir, NETWORK_LOG_RING_SIZE: '3', ...extra });
  const bus = new RealtimeBus();
  const events: DomainEvent[] = [];
  bus.subscribe((event) => events.push(event));
  return { log: new NetworkLog(config, bus), events, dir };
}

describe('NetworkLog', () => {
  it('publishes a network event and assigns an id, storing the entry verbatim', () => {
    const { log, events } = createLog();
    log.record(entry({ detail: 'hello' }));

    expect(events).toHaveLength(1);
    const published = events[0];
    expect(published?.type).toBe('network');
    if (published?.type !== 'network') throw new Error('expected network event');
    expect(published.entry.id).toBeTruthy();
    expect(published.entry.detail).toBe('hello');
    // The type carries no cookie/token field — redaction is structural.
    expect(Object.keys(published.entry)).not.toContain('cookie');
  });

  it('keeps only the newest NETWORK_LOG_RING_SIZE entries in memory', () => {
    const { log } = createLog();
    for (let index = 0; index < 5; index += 1) {
      log.record(entry({ detail: `n${index}` }));
    }
    const recent = log.recent();
    expect(recent).toHaveLength(3);
    expect(recent.map((item) => item.detail)).toEqual(['n2', 'n3', 'n4']);
  });

  it('appends JSONL to the log file and rotates past LOG_MAX_BYTES', () => {
    const { log, dir } = createLog({ LOG_MAX_BYTES: '1000' });
    for (let index = 0; index < 30; index += 1) {
      log.record(entry({ detail: `padding-line-${index}-${'x'.repeat(40)}` }));
    }
    const filePath = join(dir, 'network.log.jsonl');
    expect(existsSync(filePath)).toBe(true);
    expect(existsSync(`${filePath}.1`)).toBe(true);
    // Each written line is valid JSON.
    const lines = readFileSync(filePath, 'utf8').trim().split('\n');
    for (const line of lines) {
      expect(() => {
        JSON.parse(line);
      }).not.toThrow();
    }
  });

  it('exposes the log file path', () => {
    const { log, dir } = createLog();
    expect(log.logFilePath()).toBe(join(dir, 'network.log.jsonl'));
  });
});
