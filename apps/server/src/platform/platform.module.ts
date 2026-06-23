import { Module, type DynamicModule } from '@nestjs/common';
import { PERMISSION_PROBE } from './platform.tokens.js';
import type { DesktopPlatform } from './ports.js';

/**
 * Global module that publishes the desktop-platform ports as DI tokens. The
 * concrete `DesktopPlatform` (real adapters from `apps/desktop`, or the no-op
 * default) is supplied once at boot via `register()` — BEFORE `app.listen()` —
 * so every consumer resolves the right adapter from the first request with no
 * post-boot swap and no startup race.
 */
@Module({})
export class PlatformModule {
  static register(platform: DesktopPlatform): DynamicModule {
    return {
      module: PlatformModule,
      global: true,
      providers: [{ provide: PERMISSION_PROBE, useValue: platform.permissionProbe }],
      exports: [PERMISSION_PROBE],
    };
  }
}
