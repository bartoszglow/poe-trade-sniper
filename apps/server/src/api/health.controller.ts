import { Controller, Get, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE } from '../db/db.module.js';
import type { SniperDatabase } from '../db/migrate.js';
import { APP_VERSION } from '../version.js';

export interface HealthResponse {
  status: 'ok';
  version: string;
  dbMigrated: boolean;
}

@Controller()
export class HealthController {
  constructor(@Inject(DATABASE) private readonly database: SniperDatabase) {}

  @Get('health')
  health(): HealthResponse {
    const migrationRows = this.database.get<{ count: number }>(
      sql`SELECT COUNT(*) AS count FROM __drizzle_migrations`,
    );
    return {
      status: 'ok',
      version: APP_VERSION,
      dbMigrated: (migrationRows?.count ?? 0) > 0,
    };
  }
}
