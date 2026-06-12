import { Global, Module } from '@nestjs/common';
import { DATABASE } from '../db/db.module.js';
import type { SniperDatabase } from '../db/migrate.js';
import { DbSessionStore } from './db-session-store.js';
import { LoginCaptureService } from './login-capture.service.js';
import { SessionBootProbe } from './session-boot-probe.js';
import { SessionCipher } from './session-cipher.js';
import { SessionController } from './session.controller.js';
import { SessionService } from './session.service.js';
import { SESSION_STORE } from './session-store.js';

@Global()
@Module({
  controllers: [SessionController],
  providers: [
    SessionCipher,
    {
      provide: SESSION_STORE,
      inject: [DATABASE, SessionCipher],
      useFactory: (database: SniperDatabase, cipher: SessionCipher) =>
        new DbSessionStore(database, cipher),
    },
    SessionService,
    LoginCaptureService,
    SessionBootProbe,
  ],
  exports: [SessionService, LoginCaptureService],
})
export class SessionModule {}
