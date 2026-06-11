import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/migrate.js';
import { HealthController } from './health.controller.js';

describe('HealthController', () => {
  it('reports ok with dbMigrated=true on a migrated database', () => {
    const database = openDatabase(':memory:');
    try {
      const controller = new HealthController(database);
      const response = controller.health();
      expect(response.status).toBe('ok');
      expect(response.dbMigrated).toBe(true);
      expect(response.version).toMatch(/^\d+\.\d+\.\d+$/);
    } finally {
      database.$client.close();
    }
  });
});
