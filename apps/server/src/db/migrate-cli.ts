import { loadConfig } from '../config/env.js';
import { openDatabase } from './migrate.js';

// Manual migration runner (`pnpm db:migrate`). Startup also migrates; this
// exists for running migrations without booting the server.
const config = loadConfig();
const database = openDatabase(config.DB_PATH);
database.$client.close();
console.warn(`Migrations applied to ${config.DB_PATH}`);
