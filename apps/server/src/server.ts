import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { loadConfig, type AppConfig } from './config/env.js';

export interface RunningServer {
  app: INestApplication;
  port: number;
  config: AppConfig;
}

/**
 * Boots the sniper server and resolves once it listens. Shell-agnostic — the
 * CLI (`main.ts`) and the Electron main process both call this; environment
 * (DB_PATH, STATIC_DIR, PORT) must be set before the call.
 */
export async function startServer(): Promise<RunningServer> {
  // Parse config before Nest boots so a bad .env dies with a readable error,
  // not a DI stack trace.
  const config = loadConfig();

  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  await app.listen(config.PORT, config.HOST);
  return { app, port: config.PORT, config };
}
