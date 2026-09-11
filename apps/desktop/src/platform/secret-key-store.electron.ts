import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { app, safeStorage } from 'electron';
import type { SecretKeyStore } from '@poe-sniper/server';

const KEY_FILE = 'session-key.enc';
const KEY_BYTES = 32;

/**
 * `SecretKeyStore` backed by Electron `safeStorage` — the login keychain on
 * macOS, DPAPI on Windows, libsecret/kwallet on Linux. This is what makes the
 * session encrypted at rest on EVERY platform (the standalone fallback is the
 * macOS-only `security` CLI, which leaves Windows/Linux plaintext).
 *
 * Envelope encryption: a random 32-byte AES key is generated once and persisted
 * WRAPPED by safeStorage, so `SessionCipher` keeps one AES-GCM format across all
 * shells and the OS only ever guards the small key blob.
 *
 * Build this AFTER `app.whenReady()` — safeStorage has no backend before it.
 */
export function createSafeStorageSecretKeyStore(): SecretKeyStore {
  let cached: Buffer | null | undefined;

  const warn = (message: string): void => {
    // No Nest logger here (this runs in the Electron main before the server boots).
    console.warn(`[SafeStorageSecretKeyStore] ${message}`);
  };

  /**
   * Linux without a keyring silently selects the `basic_text` backend, which
   * "encrypts" with a hardcoded key — no real protection. Report it as
   * unavailable so the operator gets an honest plaintext warning instead of a
   * false sense of security.
   */
  const encryptionIsReal = (): boolean => {
    if (!safeStorage.isEncryptionAvailable()) return false;
    if (process.platform !== 'linux') return true;
    return safeStorage.getSelectedStorageBackend() !== 'basic_text';
  };

  const read = (): Buffer | null => {
    if (!encryptionIsReal()) {
      warn('no OS secret store available (no keyring backend) — session stays plaintext at rest');
      return null;
    }
    const keyPath = join(app.getPath('userData'), KEY_FILE);
    if (existsSync(keyPath)) {
      try {
        const key = Buffer.from(safeStorage.decryptString(readFileSync(keyPath)), 'hex');
        if (key.length === KEY_BYTES) return key;
        warn(
          'stored session key is malformed — regenerating (a saved session will need a re-login)',
        );
      } catch {
        // The OS store was reset or this is a different user/machine. The old
        // session can never be decrypted again, so mint a fresh key; the store
        // treats the unreadable session as "no session" and the user logs in again.
        warn('stored session key could not be unwrapped — regenerating (re-login required)');
      }
    }
    try {
      const generated = randomBytes(KEY_BYTES);
      writeFileSync(keyPath, safeStorage.encryptString(generated.toString('hex')), { mode: 0o600 });
      return generated;
    } catch (error) {
      warn(
        `could not persist the session key (${String(error)}) — session stays plaintext at rest`,
      );
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
