import { Module } from '@nestjs/common';
import { ApiModule } from './api/api.module.js';
import { ConfigModule } from './config/config.module.js';
import { DbModule } from './db/db.module.js';
import { EventsModule } from './events/events.module.js';
import { SessionModule } from './session/session.module.js';

@Module({
  imports: [ConfigModule, DbModule, EventsModule, SessionModule, ApiModule],
})
export class AppModule {}
