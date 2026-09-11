import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { SECRET_KEY_STORE } from '../platform/platform.tokens.js';
import type { SecretKeyStore } from '../platform/ports.js';

export interface EncryptedPayload {
  __enc: 1;
  iv: string;
  tag: string;
  data: string;
}

export function isEncryptedPayload(value: unknown): value is EncryptedPayload {
  return typeof value === 'object' && value !== null && (value as { __enc?: number }).__enc === 1;
}

/**
 * AES-256-GCM for the session at rest (closes D-7). The key comes from the
 * platform's `SecretKeyStore` — the macOS keychain for the standalone server,
 * Electron `safeStorage` (OS-backed on macOS/Windows/Linux) in the packaged
 * desktop app. Where no store exists the session stays plaintext with a loud
 * warning, so a keyring-less machine still works.
 */
@Injectable()
export class SessionCipher {
  private readonly logger = new Logger(SessionCipher.name);
  private warnedPlaintext = false;

  constructor(@Inject(SECRET_KEY_STORE) private readonly keyStore: SecretKeyStore) {}

  /** null when no key source exists — caller stores plaintext. */
  encrypt(plaintext: string): EncryptedPayload | null {
    const key = this.keyStore.loadKey();
    if (!key) {
      if (!this.warnedPlaintext) {
        this.warnedPlaintext = true;
        this.logger.warn(
          'no OS secret store on this machine — the PoE session is stored PLAINTEXT at rest',
        );
      }
      return null;
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
      __enc: 1,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: data.toString('base64'),
    };
  }

  decrypt(payload: EncryptedPayload): string {
    const key = this.keyStore.loadKey();
    if (!key) throw new Error('encrypted session present but no key available');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(payload.data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}
