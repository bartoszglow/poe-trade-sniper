import { describe, expect, it } from 'vitest';
import { loadConfig } from './env.js';

describe('loadConfig', () => {
  it('applies defaults for an empty environment', () => {
    const config = loadConfig({});
    expect(config.APP_ENV).toBe('development');
    expect(config.PORT).toBe(3500);
    expect(config.DB_PATH).toBe('./data/dev.db');
  });

  it('parses provided values', () => {
    const config = loadConfig({ APP_ENV: 'production', PORT: '8080', DB_PATH: '/tmp/sniper.db' });
    expect(config.APP_ENV).toBe('production');
    expect(config.PORT).toBe(8080);
    expect(config.DB_PATH).toBe('/tmp/sniper.db');
  });

  it('fails fast with a readable error on an invalid port', () => {
    expect(() => loadConfig({ PORT: 'not-a-port' })).toThrowError(
      /Invalid environment configuration:[\s\S]*PORT/,
    );
  });

  it('rejects an unknown APP_ENV', () => {
    expect(() => loadConfig({ APP_ENV: 'staging' })).toThrowError(/APP_ENV/);
  });

  it('applies the buy-automation tunable defaults', () => {
    const config = loadConfig({});
    expect(config.BUY_CAPTURE_POLL_MS).toBe(100);
    expect(config.BUY_CAPTURE_TIMEOUT_MS).toBe(5_000);
    expect(config.BUY_SYNTHETIC_INPUT_GRACE_MS).toBe(120);
    expect(config.BUY_FOCUS_VERIFY_MS).toBe(250);
    expect(config.BUY_SHOP_TIMEOUT_MS).toBe(15_000);
    expect(config.BUY_ITEM_GRACE_MS).toBe(2_500);
    expect(config.BUY_RUN_TIMEOUT_MS).toBe(25_000);
  });

  it('enforces the buy-automation tunable min bounds', () => {
    expect(() => loadConfig({ BUY_CAPTURE_POLL_MS: '5' })).toThrowError(
      /Invalid environment configuration:[\s\S]*BUY_CAPTURE_POLL_MS/,
    );
    expect(() => loadConfig({ BUY_CAPTURE_TIMEOUT_MS: '100' })).toThrowError(
      /BUY_CAPTURE_TIMEOUT_MS/,
    );
  });
});
