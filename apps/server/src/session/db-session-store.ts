import { eq } from 'drizzle-orm';
import type { SessionState } from '@poe-sniper/shared';
import { appState } from '../db/schema.js';
import type { SniperDatabase } from '../db/migrate.js';
import type { SessionStore } from './session-store.js';

const SESSION_KEY = 'session';

/** app_state-backed session persistence (single row, key 'session'). */
export class DbSessionStore implements SessionStore {
  constructor(private readonly database: SniperDatabase) {}

  load(): SessionState | null {
    const row = this.database.select().from(appState).where(eq(appState.key, SESSION_KEY)).get();
    return row ? (row.value as SessionState) : null;
  }

  save(state: SessionState): void {
    const updatedAt = new Date().toISOString();
    this.database
      .insert(appState)
      .values({ key: SESSION_KEY, value: state, updatedAt })
      .onConflictDoUpdate({ target: appState.key, set: { value: state, updatedAt } })
      .run();
  }

  clear(): void {
    this.database.delete(appState).where(eq(appState.key, SESSION_KEY)).run();
  }
}
