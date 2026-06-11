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
});
