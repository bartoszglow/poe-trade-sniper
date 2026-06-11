import { Module } from '@nestjs/common';
import { ApiModule } from './api/api.module.js';
import { ConfigModule } from './config/config.module.js';
import { DbModule } from './db/db.module.js';

@Module({
  imports: [ConfigModule, DbModule, ApiModule],
})
export class AppModule {}
