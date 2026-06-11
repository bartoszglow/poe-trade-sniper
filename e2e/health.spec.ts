import { expect, test } from '@playwright/test';

// Placeholder e2e proving the harness: boots the real server (webServer in
// playwright.config.ts) and hits the API. Real flows arrive with Phase 1,
// driven against recorded fixtures — never live GGG.
test('health endpoint reports a migrated database', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.ok()).toBeTruthy();

  const body = (await response.json()) as { status: string; version: string; dbMigrated: boolean };
  expect(body.status).toBe('ok');
  expect(body.dbMigrated).toBe(true);
  expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
});
