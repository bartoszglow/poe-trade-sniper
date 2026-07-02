import { Module, type DynamicModule } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ActivityModule } from './activity/activity.module.js';
import { ApiModule } from './api/api.module.js';
import { BuyAutomationModule } from './buy-automation/buy-automation.module.js';
import { ConfigModule } from './config/config.module.js';
import { loadConfig } from './config/env.js';
import { DbModule } from './db/db.module.js';
import { DevModule } from './dev/dev.module.js';
import { EventsModule } from './events/events.module.js';
import { ExportImportModule } from './export-import/export-import.module.js';
import { GuardModule } from './guard/guard.module.js';
import { NetworkModule } from './network/network.module.js';
import { PermissionsModule } from './permissions/permissions.module.js';
import { PlatformModule } from './platform/platform.module.js';
import type { DesktopPlatform } from './platform/ports.js';
import { PriceCheckModule } from './price-check/price-check.module.js';
import { RateLimitModule } from './ratelimit/ratelimit.module.js';
import { SessionModule } from './session/session.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { TradeApiModule } from './trade-api/trade-api.module.js';
import { TravelModule } from './travel/travel.module.js';
import { UpdateModule } from './update/update.module.js';

/**
 * Root module. Dynamic so the desktop-platform aggregate (real adapters from
 * the Electron shell, or the no-op default) is injected once at boot via
 * `register()` — see `startServer()`. `PlatformModule` is global, so the ports
 * are available to every feature module without an explicit import.
 */
@Module({})
export class AppModule {
  static register(platform: DesktopPlatform): DynamicModule {
    // Resolved at register time, not via DI: the module list itself depends on it.
    // Callers (CLI, Electron main) set the environment before calling startServer.
    const config = loadConfig();
    return {
      module: AppModule,
      imports: [
        PlatformModule.register(platform),
        ConfigModule,
        // Desktop/one-origin mode: serve the built web UI next to the API.
        ...(config.STATIC_DIR
          ? [
              ServeStaticModule.forRoot({
                rootPath: config.STATIC_DIR,
                exclude: ['/api/{*splat}'],
              }),
            ]
          : []),
        // Dev-only: the permission-status push endpoint (dev↔prod parity).
        ...(config.APP_ENV === 'development' ? [DevModule] : []),
        DbModule,
        EventsModule,
        SettingsModule,
        NetworkModule,
        GuardModule,
        SessionModule,
        RateLimitModule,
        TradeApiModule,
        TravelModule,
        UpdateModule,
        PermissionsModule,
        BuyAutomationModule,
        ActivityModule,
        ExportImportModule,
        PriceCheckModule,
        ApiModule,
      ],
    };
  }
}
