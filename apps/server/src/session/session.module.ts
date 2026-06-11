import { Global, Module } from '@nestjs/common';
import { DATABASE } from '../db/db.module.js';
import type { SniperDatabase } from '../db/migrate.js';
import { DbSessionStore } from './db-session-store.js';
import { SessionController } from './session.controller.js';
import { SessionService } from './session.service.js';
import { SESSION_STORE } from './session-store.js';

@Global()
@Module({
  controllers: [SessionController],
  providers: [
    {
      provide: SESSION_STORE,
      inject: [DATABASE],
      useFactory: (database: SniperDatabase) => new DbSessionStore(database),
    },
    SessionService,
  ],
  exports: [SessionService],
})
export class SessionModule {}
