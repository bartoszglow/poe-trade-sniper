import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:3500',
  },
  webServer: {
    command: 'pnpm exec tsx src/main.ts',
    cwd: './apps/server',
    url: 'http://localhost:3500/api/health',
    reuseExistingServer: !process.env.CI,
    env: {
      APP_ENV: 'test',
      PORT: '3500',
      DB_PATH: './data/e2e.db',
    },
  },
});
