import { Module, type DynamicModule } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ApiModule } from './api/api.module.js';
import { BuyAutomationModule } from './buy-automation/buy-automation.module.js';
import { ConfigModule } from './config/config.module.js';
import { loadConfig } from './config/env.js';
import { DbModule } from './db/db.module.js';
import { EventsModule } from './events/events.module.js';
import { GuardModule } from './guard/guard.module.js';
import { NetworkModule } from './network/network.module.js';
import { PermissionsModule } from './permissions/permissions.module.js';
import { PlatformModule } from './platform/platform.module.js';
import type { DesktopPlatform } from './platform/ports.js';
import { RateLimitModule } from './ratelimit/ratelimit.module.js';
import { SessionModule } from './session/session.module.js';
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
    const staticDir = loadConfig().STATIC_DIR;
    return {
      module: AppModule,
      imports: [
        PlatformModule.register(platform),
        ConfigModule,
        // Desktop/one-origin mode: serve the built web UI next to the API.
        ...(staticDir
          ? [ServeStaticModule.forRoot({ rootPath: staticDir, exclude: ['/api/{*splat}'] })]
          : []),
        DbModule,
        EventsModule,
        NetworkModule,
        GuardModule,
        SessionModule,
        RateLimitModule,
        TradeApiModule,
        TravelModule,
        UpdateModule,
        PermissionsModule,
        BuyAutomationModule,
        ApiModule,
      ],
    };
  }
}
