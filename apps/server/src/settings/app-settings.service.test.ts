import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/migrate.js';
import { AppSettingsService } from './app-settings.service.js';

describe('AppSettingsService', () => {
  it('defaults cursorMode to "instant" when nothing is stored', () => {
    const settings = new AppSettingsService(openDatabase(':memory:'));
    settings.onApplicationBootstrap();
    expect(settings.get().cursorMode).toBe('instant');
  });

  it('persists an update and a fresh service reads it back', () => {
    const database = openDatabase(':memory:');
    const first = new AppSettingsService(database);
    first.onApplicationBootstrap();
    expect(first.update({ cursorMode: 'smooth' }).cursorMode).toBe('smooth');
    expect(first.get().cursorMode).toBe('smooth');

    // a new instance over the SAME db loads the persisted value at boot
    const second = new AppSettingsService(database);
    second.onApplicationBootstrap();
    expect(second.get().cursorMode).toBe('smooth');
  });

  it('defaults dealMaxWatches to 25 (D-dw-17)', () => {
    const settings = new AppSettingsService(openDatabase(':memory:'));
    settings.onApplicationBootstrap();
    expect(settings.get().dealMaxWatches).toBe(25);
  });

  it('notifies change listeners with next + previous on update (D-dw-17)', () => {
    const settings = new AppSettingsService(openDatabase(':memory:'));
    settings.onApplicationBootstrap();
    const calls: Array<{ next: number; previous: number }> = [];
    settings.onChange((next, previous) =>
      calls.push({ next: next.dealMaxWatches, previous: previous.dealMaxWatches }),
    );
    settings.update({ dealMaxWatches: 40 });
    expect(calls).toEqual([{ next: 40, previous: 25 }]);
  });

  it('a throwing change listener never breaks the settings write', () => {
    const settings = new AppSettingsService(openDatabase(':memory:'));
    settings.onApplicationBootstrap();
    settings.onChange(() => {
      throw new Error('boom');
    });
    expect(settings.update({ dealMaxWatches: 40 }).dealMaxWatches).toBe(40);
  });
});
