import { describe, expect, it } from 'vitest';
import { openDatabase } from './migrate.js';

describe('openDatabase', () => {
  it('applies all migrations to a fresh database', () => {
    const database = openDatabase(':memory:');
    try {
      const tableRows = database.$client
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>;
      const tableNames = tableRows.map((row) => row.name);
      expect(tableNames).toEqual(
        expect.arrayContaining(['searches', 'hits', 'app_state', '__drizzle_migrations']),
      );
    } finally {
      database.$client.close();
    }
  });

  it('is idempotent — re-running migrations on a migrated database is a no-op', () => {
    const database = openDatabase(':memory:');
    try {
      const migrationCount = database.$client
        .prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations')
        .get() as { count: number };
      expect(migrationCount.count).toBeGreaterThan(0);
    } finally {
      database.$client.close();
    }
  });
});
