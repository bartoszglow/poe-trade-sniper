import { execFileSync } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';

export interface EncryptedPayload {
  __enc: 1;
  iv: string;
  tag: string;
  data: string;
}

export function isEncryptedPayload(value: unknown): value is EncryptedPayload {
  return typeof value === 'object' && value !== null && (value as { __enc?: number }).__enc === 1;
}

const KEYCHAIN_SERVICE = 'poe-trade-sniper';
const KEYCHAIN_ACCOUNT = 'session-encryption-key';

/**
 * AES-256-GCM for the session at rest (closes D-7). The key lives in the OS
 * keychain (macOS `security` CLI — no native deps); created on first use.
 * Where no keychain exists the session stays plaintext with a loud warning —
 * Electron's safeStorage takes over in packaged desktop builds.
 */
export type KeyLoader = () => Buffer | null;

export function keychainKeyLoader(logger: Logger): KeyLoader {
  return () => {
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
}

@Injectable()
export class SessionCipher {
  private readonly logger = new Logger(SessionCipher.name);
  private key: Buffer | null | undefined;
  private readonly keyLoader: KeyLoader;

  constructor(keyLoader?: KeyLoader) {
    this.keyLoader = keyLoader ?? keychainKeyLoader(this.logger);
  }

  /** null when no key source exists — caller stores plaintext. */
  encrypt(plaintext: string): EncryptedPayload | null {
    const key = this.loadKey();
    if (!key) return null;
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
    const key = this.loadKey();
    if (!key) throw new Error('encrypted session present but no key available');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(payload.data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  private loadKey(): Buffer | null {
    if (this.key === undefined) this.key = this.keyLoader();
    return this.key;
  }
}
