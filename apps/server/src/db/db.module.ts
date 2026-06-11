import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { openDatabase, type SniperDatabase } from './migrate.js';

/** Injection token for the migrated Drizzle database. */
export const DATABASE = Symbol('DATABASE');

@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => openDatabase(config.DB_PATH),
    },
  ],
  exports: [DATABASE],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly database: SniperDatabase) {}

  onApplicationShutdown(): void {
    this.database.$client.close();
  }
}
