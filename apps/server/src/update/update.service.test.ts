import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config/env.js';
import { isNewerVersion, UpdateService } from './update.service.js';

describe('isNewerVersion', () => {
  it('compares semver parts numerically', () => {
    expect(isNewerVersion('0.1.0', '0.0.0')).toBe(true);
    expect(isNewerVersion('1.0.0', '0.9.9')).toBe(true);
    expect(isNewerVersion('0.2.10', '0.2.9')).toBe(true);
    expect(isNewerVersion('v1.2.0', '1.2.0')).toBe(false);
    expect(isNewerVersion('1.2.0', '1.3.0')).toBe(false);
  });

  it('ignores a leading v and a pre-release suffix', () => {
    expect(isNewerVersion('v2.0.0-rc1', '1.9.0')).toBe(true);
    expect(isNewerVersion('1.0.0-beta', '1.0.0')).toBe(false);
  });
});

describe('UpdateService', () => {
  it('reports no update (and never fetches) when no repo is configured', async () => {
    const service = new UpdateService(loadConfig({ GITHUB_RELEASES_REPO: '' }));
    const status = await service.check();
    expect(status.updateAvailable).toBe(false);
    expect(status.latestVersion).toBeNull();
    expect(status.currentVersion).toBeTruthy();
  });
});
