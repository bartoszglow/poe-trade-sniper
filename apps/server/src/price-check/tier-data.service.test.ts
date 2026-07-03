import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { TierDataService } from './tier-data.service.js';

const FIXTURE = fileURLToPath(new URL('./__fixtures__/tier-data.json', import.meta.url));

describe('TierDataService', () => {
  afterEach(() => {
    delete process.env['TIER_DATA_PATH'];
  });

  it('picks the tier whose range contains the roll; null outside/unknown/no-roll', () => {
    process.env['TIER_DATA_PATH'] = FIXTURE;
    const service = new TierDataService();
    expect(service.tierForRoll('explicit.stat_life', 55)).toEqual({ tier: 2, min: 52, max: 60 });
    expect(service.tierForRoll('explicit.stat_life', 70)).toEqual({ tier: 1, min: 61, max: 80 });
    expect(service.tierForRoll('explicit.stat_life', 999)).toBeNull();
    expect(service.tierForRoll('explicit.stat_life', null)).toBeNull();
    expect(service.tierForRoll('unknown.stat', 10)).toBeNull();
  });

  it('missing file → tiers simply unavailable (graceful, core check unaffected)', () => {
    process.env['TIER_DATA_PATH'] = '/definitely/not/here/tier-data.json';
    const service = new TierDataService();
    expect(service.tierForRoll('explicit.stat_life', 55)).toBeNull();
  });
});
