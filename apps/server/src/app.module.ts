import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import { DbModule } from './db/db.module.js';

@Module({
  imports: [ConfigModule, DbModule],
})
export class AppModule {}
