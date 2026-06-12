import { defineConfig } from '@playwright/test';

// Dedicated port + NO server reuse: e2e mutates session state and must never
// hit a running dev server (it would wipe the operator's real session).
export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:3590',
  },
  webServer: {
    command: 'pnpm exec tsx src/main.ts',
    cwd: './apps/server',
    url: 'http://localhost:3590/api/health',
    reuseExistingServer: false,
    env: {
      APP_ENV: 'test',
      PORT: '3590',
      DB_PATH: './data/e2e.db',
    },
  },
});
