import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

/**
 * Migrations live at the package root (apps/server/db/migrations) so the same
 * relative hop works from src/ (tsx dev) and dist/ (built) alike.
 */
const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

export type SniperDatabase = ReturnType<typeof openDatabase>;

/**
 * Opens (creating if needed) the SQLite database and applies all pending
 * forward-only migrations. Called on every startup — a fresh file ends up
 * fully migrated, an up-to-date one is a no-op.
 */
export function openDatabase(databasePath: string) {
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(resolve(databasePath)), { recursive: true });
  }
  const sqlite = new Database(databasePath);
  sqlite.pragma('journal_mode = WAL');
  const database = drizzle(sqlite, { schema });
  migrate(database, { migrationsFolder });
  return database;
}
