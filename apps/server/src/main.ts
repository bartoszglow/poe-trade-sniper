import { Logger } from '@nestjs/common';
import { startServer } from './server.js';

startServer()
  .then(({ port, config }) => {
    Logger.log(`Server listening on http://localhost:${port} (${config.APP_ENV})`, 'Bootstrap');
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
