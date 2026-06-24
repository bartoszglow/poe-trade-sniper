import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { loadConfig, type AppConfig } from './config/env.js';
import { createNoopPlatform } from './platform/noop-platform.js';
import type { DesktopPlatform } from './platform/ports.js';

export interface RunningServer {
  app: INestApplication;
  port: number;
  config: AppConfig;
}

// Re-exported so the desktop shell (its only @poe-sniper/* dependency) can type
// the platform adapters it injects, without depending on @poe-sniper/shared.
export type { DesktopPlatform, PermissionProbe } from './platform/ports.js';
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
export async function startServer(options: StartServerOptions = {}): Promise<RunningServer> {
  // Parse config before Nest boots so a bad .env dies with a readable error,
  // not a DI stack trace.
  const config = loadConfig();
  const platform = options.platformFactory?.() ?? createNoopPlatform();

  const app = await NestFactory.create(AppModule.register(platform));
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  await app.listen(config.PORT, config.HOST);
  return { app, port: config.PORT, config };
}
