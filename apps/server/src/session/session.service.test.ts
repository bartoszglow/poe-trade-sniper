import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/migrate.js';
import { DbSessionStore } from './db-session-store.js';
import { SessionCipher } from './session-cipher.js';
import { SessionService } from './session.service.js';

// Fixed key — unit tests must never touch the real OS keychain.
const TEST_CIPHER = new SessionCipher(() => Buffer.alloc(32, 7));

function createService() {
  const database = openDatabase(':memory:');
  return { service: new SessionService(new DbSessionStore(database, TEST_CIPHER)), database };
}

describe('SessionService', () => {
  it('round-trips a pasted cookie session through the DB store', () => {
    const { service, database } = createService();
    try {
      const status = service.setFromCookies(
        { POESESSID: 'secret-value', cf_clearance: 'cf-secret' },
        'TestAgent/1.0',
      );
      expect(status.hasSession).toBe(true);
      expect(status.cookieNames).toEqual(['POESESSID', 'cf_clearance']);

      const session = service.getSession();
      expect(session?.userAgent).toBe('TestAgent/1.0');
      expect(service.buildCookieHeader(session!)).toBe(
        'POESESSID=secret-value; cf_clearance=cf-secret',
      );
    } finally {
      database.$client.close();
    }
  });

  it('rejects a paste without POESESSID', () => {
    const { service, database } = createService();
    try {
      expect(() => service.setFromCookies({ cf_clearance: 'x' }, 'UA')).toThrowError(/POESESSID/);
    } finally {
      database.$client.close();
    }
  });

  it('public status never contains cookie values', () => {
    const { service, database } = createService();
    try {
      service.setFromCookies({ POESESSID: 'super-secret' }, 'UA');
      const serialized = JSON.stringify(service.publicStatus());
      expect(serialized).not.toContain('super-secret');
    } finally {
      database.$client.close();
    }
  });

  it('persists the session encrypted at rest (D-7) and reads legacy plaintext', () => {
    const { service, database } = createService();
    try {
      service.setFromCookies({ POESESSID: 'super-secret' }, 'UA');
      const rawRow = database.$client
        .prepare("SELECT value FROM app_state WHERE key = 'session'")
        .get() as { value: string };
      expect(rawRow.value).not.toContain('super-secret');
      expect(JSON.parse(rawRow.value)).toMatchObject({ __enc: 1 });
      // round-trip through decryption
      expect(service.getSession()?.cookies['POESESSID']).toBe('super-secret');

      // legacy plaintext row stays readable
      database.$client
        .prepare("UPDATE app_state SET value = ? WHERE key = 'session'")
        .run(
          JSON.stringify({ cookies: { POESESSID: 'legacy' }, userAgent: 'UA', capturedAt: 'x' }),
        );
      expect(service.getSession()?.cookies['POESESSID']).toBe('legacy');
    } finally {
      database.$client.close();
    }
  });

  it('imports the prototype export: filters foreign cookies, fixes headless UA', () => {
    const { service, database } = createService();
    try {
      const status = service.importFromPrototypeExport({
        userAgent: 'Mozilla/5.0 HeadlessChrome/130.0',
        cookies: [
          { name: 'POESESSID', value: 'v1', domain: 'www.pathofexile.com' },
          { name: 'cf_clearance', value: 'v2', domain: '.pathofexile.com' },
          { name: 'YSC', value: 'v3', domain: '.youtube.com' },
        ],
      });
      expect(status.cookieNames).toEqual(['POESESSID', 'cf_clearance']);
      expect(service.getSession()?.userAgent).toBe('Mozilla/5.0 Chrome/130.0');
    } finally {
      database.$client.close();
    }
  });

  it('clear() wipes the session and resets the probe', () => {
    const { service, database } = createService();
    try {
      service.setFromCookies({ POESESSID: 'x' }, 'UA');
      service.markProbeResult(true);
      service.clear();
      const status = service.publicStatus();
      expect(status.hasSession).toBe(false);
      expect(status.probedValid).toBeNull();
    } finally {
      database.$client.close();
    }
  });
});
