import { eq } from 'drizzle-orm';
import type { SessionState } from '@poe-sniper/shared';
import { appState } from '../db/schema.js';
import type { SniperDatabase } from '../db/migrate.js';
import { isEncryptedPayload, type SessionCipher } from './session-cipher.js';
import type { SessionStore } from './session-store.js';

const SESSION_KEY = 'session';

/**
 * app_state-backed session persistence (single row, key 'session'),
 * AES-GCM-encrypted at rest when a key source exists (D-7). Legacy plaintext
 * rows are still readable and get encrypted on the next save.
 */
export class DbSessionStore implements SessionStore {
  constructor(
    private readonly database: SniperDatabase,
    private readonly cipher: SessionCipher,
  ) {}

  load(): SessionState | null {
    const row = this.database.select().from(appState).where(eq(appState.key, SESSION_KEY)).get();
    if (!row) return null;
    if (isEncryptedPayload(row.value)) {
      return JSON.parse(this.cipher.decrypt(row.value)) as SessionState;
    }
    return row.value as SessionState;
  }

  save(state: SessionState): void {
    const updatedAt = new Date().toISOString();
    const value = this.cipher.encrypt(JSON.stringify(state)) ?? state;
    this.database
      .insert(appState)
      .values({ key: SESSION_KEY, value, updatedAt })
      .onConflictDoUpdate({ target: appState.key, set: { value, updatedAt } })
      .run();
  }

  clear(): void {
    this.database.delete(appState).where(eq(appState.key, SESSION_KEY)).run();
  }
}
