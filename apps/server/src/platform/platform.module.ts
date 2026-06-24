import { Module, type DynamicModule } from '@nestjs/common';
import {
  CAPTURE_SOURCE,
  INPUT_CONTROLLER,
  PERMISSION_PROBE,
  TRADE_VISION,
  USER_INPUT_WATCHER,
} from './platform.tokens.js';
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
      providers: [
        { provide: PERMISSION_PROBE, useValue: platform.permissionProbe },
        { provide: CAPTURE_SOURCE, useValue: platform.captureSource },
        { provide: TRADE_VISION, useValue: platform.tradeVision },
        { provide: INPUT_CONTROLLER, useValue: platform.inputController },
        { provide: USER_INPUT_WATCHER, useValue: platform.userInputWatcher },
      ],
      exports: [
        PERMISSION_PROBE,
        CAPTURE_SOURCE,
        TRADE_VISION,
        INPUT_CONTROLLER,
        USER_INPUT_WATCHER,
      ],
    };
  }
}
