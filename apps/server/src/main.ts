import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { loadConfig } from './config/env.js';

async function bootstrap(): Promise<void> {
  // Parse config before Nest boots so a bad .env dies with a readable error,
  // not a DI stack trace.
  const config = loadConfig();

  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  await app.listen(config.PORT);
  Logger.log(
    `Server listening on http://localhost:${config.PORT} (${config.APP_ENV})`,
    'Bootstrap',
  );
}

bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
