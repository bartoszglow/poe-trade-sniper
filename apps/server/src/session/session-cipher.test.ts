import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { SecretKeyStore } from '../platform/ports.js';
import { SessionCipher, isEncryptedPayload } from './session-cipher.js';

const keyStoreWith = (key: Buffer | null): SecretKeyStore => ({ loadKey: () => key });

describe('SessionCipher', () => {
  it('round-trips a payload through AES-GCM', () => {
    const cipher = new SessionCipher(keyStoreWith(randomBytes(32)));
    const secret = JSON.stringify({ cookies: { POESESSID: 'top-secret' } });

    const encrypted = cipher.encrypt(secret);

    expect(encrypted).not.toBeNull();
    expect(cipher.decrypt(encrypted!)).toBe(secret);
  });

  it('never leaves the plaintext readable in the encrypted payload', () => {
    const cipher = new SessionCipher(keyStoreWith(randomBytes(32)));

    const encrypted = cipher.encrypt('POESESSID=top-secret');

    expect(JSON.stringify(encrypted)).not.toContain('top-secret');
    expect(isEncryptedPayload(encrypted)).toBe(true);
  });

  it('uses a fresh IV per encryption, so identical input differs on disk', () => {
    const cipher = new SessionCipher(keyStoreWith(randomBytes(32)));

    const first = cipher.encrypt('same');
    const second = cipher.encrypt('same');

    expect(first?.iv).not.toBe(second?.iv);
    expect(first?.data).not.toBe(second?.data);
  });

  it('returns null (caller stores plaintext) when the machine has no secret store', () => {
    const cipher = new SessionCipher(keyStoreWith(null));

    expect(cipher.encrypt('anything')).toBeNull();
  });

  it('refuses to decrypt when the key is gone rather than returning junk', () => {
    const encrypted = new SessionCipher(keyStoreWith(randomBytes(32))).encrypt('secret');

    const keyless = new SessionCipher(keyStoreWith(null));

    expect(() => keyless.decrypt(encrypted!)).toThrow(/no key available/);
  });

  it('rejects a payload encrypted under a different key (GCM auth) rather than trusting it', () => {
    const encrypted = new SessionCipher(keyStoreWith(randomBytes(32))).encrypt('secret');

    const otherKey = new SessionCipher(keyStoreWith(randomBytes(32)));

    expect(() => otherKey.decrypt(encrypted!)).toThrow();
  });

  it('rejects a tampered payload — the GCM tag must be authenticated', () => {
    const cipher = new SessionCipher(keyStoreWith(randomBytes(32)));
    const encrypted = cipher.encrypt('secret')!;

    const tampered = { ...encrypted, data: Buffer.from('evil').toString('base64') };

    expect(() => cipher.decrypt(tampered)).toThrow();
  });

  it('loads the key lazily, so a machine that never persists a session never touches the OS store', () => {
    let calls = 0;
    const cipher = new SessionCipher({
      loadKey: () => {
        calls += 1;
        return randomBytes(32);
      },
    });

    expect(calls).toBe(0);
    cipher.encrypt('x');
    expect(calls).toBe(1);
  });
});
