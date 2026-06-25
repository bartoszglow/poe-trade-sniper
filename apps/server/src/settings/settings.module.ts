import { Global, Module } from '@nestjs/common';
import { AppSettingsService } from './app-settings.service.js';
import { SettingsController } from './settings.controller.js';

/**
 * Global so AppSettingsService is injectable everywhere (the buy reads cursorMode,
 * StatusController surfaces it) without a circular module import.
 */
@Global()
@Module({
  controllers: [SettingsController],
  providers: [AppSettingsService],
  exports: [AppSettingsService],
})
export class SettingsModule {}
