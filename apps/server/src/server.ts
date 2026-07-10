import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger, type INestApplication } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { loadConfig, type AppConfig } from './config/env.js';
import { createDevPlatform, createNoopPlatform } from './platform/noop-platform.js';
import type { DesktopPlatform } from './platform/ports.js';

export interface RunningServer {
  app: INestApplication;
  port: number;
  config: AppConfig;
}

// Re-exported so the desktop shell (its only @poe-sniper/* dependency) can type
// the platform adapters it injects, without depending on @poe-sniper/shared.
export type {
  DesktopPlatform,
  PermissionProbe,
  CaptureSource,
  TradeVision,
  FrameAnalysis,
  InputController,
  KeyName,
  UserInputWatcher,
  RawFrame,
  WindowRegion,
  Point,
} from './platform/ports.js';
export type { PermissionKind, PermissionState } from '@poe-sniper/shared';

export interface StartServerOptions {
  /**
   * Supplies the desktop-platform adapters (permissions, and in Phase 2 capture
   * + input). The Electron shell passes this at `app.whenReady()`; everything
   * else (CLI, web, tests) omits it and gets the inert no-op platform. Built
   * BEFORE `app.listen()` so the DI container holds the real adapters from the
   * first request — no post-boot swap, no startup race.
   */
  platformFactory?: () => DesktopPlatform;
}

/**
 * Boots the sniper server and resolves once it listens. Shell-agnostic — the
 * CLI (`main.ts`) and the Electron main process both call this; environment
 * (DB_PATH, STATIC_DIR, PORT) must be set before the call.
 */
/** Installed once — a last-resort backstop so a stray rejection/exception in a
 *  fire-and-forget path (a scheduler tick, an SSE write) is LOGGED, never a
 *  silent process death that kills all detection (review F2 + full-review REL-1).
 *  Covers both the standalone server and the in-process desktop main. */
let processBackstopInstalled = false;
function installProcessBackstop(): void {
  if (processBackstopInstalled) return;
  processBackstopInstalled = true;
  const logger = new Logger('ProcessBackstop');
  process.on('unhandledRejection', (reason: unknown) => {
    logger.error(`unhandled rejection: ${reason instanceof Error ? reason.stack : String(reason)}`);
  });
  process.on('uncaughtException', (error: Error) => {
    // Log and keep running: a background throw must not take detection down. A
    // truly fatal state still surfaces via the failing operation's own errors.
    logger.error(`uncaught exception: ${error.stack ?? error.message}`);
  });
}

export async function startServer(options: StartServerOptions = {}): Promise<RunningServer> {
  installProcessBackstop();
  // Parse config before Nest boots so a bad .env dies with a readable error,
  // not a DI stack trace.
  const config = loadConfig();
  // No factory = standalone (web / CLI / test). In dev, use the dev platform —
  // its permission probe is pushable, so the Electron main feeds it real macOS
  // status and the gate behaves the same as packaged (dev↔prod parity); other
  // environments stay fully inert.
  const platform =
    options.platformFactory?.() ??
    (config.APP_ENV === 'development' ? createDevPlatform() : createNoopPlatform());

  const app = await NestFactory.create(AppModule.register(platform));
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  await app.listen(config.PORT, config.HOST);
  return { app, port: config.PORT, config };
}
