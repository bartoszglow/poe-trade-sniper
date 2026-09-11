import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { SecretKeyStore } from './ports.js';

const KEYCHAIN_SERVICE = 'poe-trade-sniper';
const KEYCHAIN_ACCOUNT = 'session-encryption-key';

/**
 * The standalone server's `SecretKeyStore`: the macOS login keychain via the
 * `security` CLI (no native dep). Created on first use.
 *
 * macOS only — every other OS has no `security` binary, so this returns null and
 * the session falls back to plaintext at rest. That is why the packaged desktop
 * shell injects the `safeStorage` store instead, which is OS-backed everywhere.
 */
export function createKeychainSecretKeyStore(
  logger = new Logger('KeychainSecretKeyStore'),
): SecretKeyStore {
  let cached: Buffer | null | undefined;

  const read = (): Buffer | null => {
    try {
      const existing = execFileSync(
        'security',
        ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim();
      if (existing) return Buffer.from(existing, 'hex');
    } catch {
      // not found yet — try to create one below
    }
    try {
      const generated = randomBytes(32).toString('hex');
      // SEC-2: the key is briefly visible in ps-readable argv during this one-time
      // creation (`security add-generic-password` takes no stdin). Accepted for the
      // single-user dev path — the packaged build uses safeStorage (D-7/D-17/D-18),
      // and a local-code-exec attacker can already read the DB this key protects.
      execFileSync(
        'security',
        [
          'add-generic-password',
          '-s',
          KEYCHAIN_SERVICE,
          '-a',
          KEYCHAIN_ACCOUNT,
          '-w',
          generated,
          '-U',
        ],
        { stdio: 'ignore' },
      );
      return Buffer.from(generated, 'hex');
    } catch {
      logger.warn('OS keychain unavailable — session will be stored PLAINTEXT at rest');
      return null;
    }
  };

  return {
    loadKey: () => {
      if (cached === undefined) cached = read();
      return cached;
    },
  };
}
