import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS, type AppSettings } from '@poe-sniper/shared';
import type { AppSettingsService } from './app-settings.service.js';
import { SettingsController } from './settings.controller.js';

function harness(): SettingsController {
  let stored: AppSettings = { ...DEFAULT_APP_SETTINGS };
  const settings = {
    get: () => stored,
    update: (patch: Partial<AppSettings>) => {
      stored = { ...stored, ...patch };
      return stored;
    },
  } as unknown as AppSettingsService;
  return new SettingsController(settings);
}

describe('SettingsController', () => {
  it('returns the current settings', () => {
    expect(harness().get().cursorMode).toBe('instant');
  });

  it('patches a valid cursorMode', () => {
    expect(harness().patch({ cursorMode: 'smooth' }).cursorMode).toBe('smooth');
  });

  it('rejects an invalid cursorMode', () => {
    expect(() => harness().patch({ cursorMode: 'teleport' })).toThrow(BadRequestException);
  });

  it('rejects unknown keys (strict)', () => {
    expect(() => harness().patch({ somethingElse: true })).toThrow(BadRequestException);
  });

  it('patches a valid dealMaxWatches (D-dw-17)', () => {
    expect(harness().patch({ dealMaxWatches: 30 }).dealMaxWatches).toBe(30);
  });

  it('rejects a dealMaxWatches above the max', () => {
    expect(() => harness().patch({ dealMaxWatches: 51 })).toThrow(BadRequestException);
  });

  it('rejects a dealMaxWatches below the min', () => {
    expect(() => harness().patch({ dealMaxWatches: 0 })).toThrow(BadRequestException);
  });

  it('rejects a non-integer dealMaxWatches', () => {
    expect(() => harness().patch({ dealMaxWatches: 12.5 })).toThrow(BadRequestException);
  });
});
