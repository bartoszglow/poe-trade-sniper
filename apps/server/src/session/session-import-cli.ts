import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { loadConfig } from '../config/env.js';
import { openDatabase } from '../db/migrate.js';
import { DbSessionStore } from './db-session-store.js';
import { SessionCipher } from './session-cipher.js';
import { SessionService } from './session.service.js';

// Bootstrap CLI: `pnpm session:import [path]` — imports the prototype's
// session-state.json. Prints cookie NAMES only; values are a credential.
const DEFAULT_EXPORT_PATH = `${process.env.HOME ?? ''}/Projects/poe2-live-sniper/session-state.json`;

const exportSchema = z.object({
  userAgent: z.string().min(1),
  cookies: z.array(z.object({ name: z.string(), value: z.string(), domain: z.string() }).loose()),
});

const exportPath = resolve(process.argv[2] ?? DEFAULT_EXPORT_PATH);
const parsed = exportSchema.safeParse(JSON.parse(readFileSync(exportPath, 'utf8')));
if (!parsed.success) {
  console.error(`Not a prototype session export: ${exportPath}`);
  process.exit(1);
}

const config = loadConfig();
const database = openDatabase(config.DB_PATH);
try {
  const sessionService = new SessionService(new DbSessionStore(database, new SessionCipher()));
  const status = sessionService.importFromPrototypeExport(parsed.data);
  console.warn(
    `Imported ${status.cookieNames.length} pathofexile.com cookie(s): ${status.cookieNames.join(', ')}`,
  );
  console.warn('Validity is probed on first use (or via GET /api/session/status after a probe).');
} finally {
  database.$client.close();
}
