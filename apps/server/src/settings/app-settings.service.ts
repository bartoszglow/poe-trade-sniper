import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { type AppSettings, DEFAULT_APP_SETTINGS } from '@poe-sniper/shared';
import { DATABASE } from '../db/db.module.js';
import type { SniperDatabase } from '../db/migrate.js';
import { appState } from '../db/schema.js';

const SETTINGS_KEY = 'settings';

/** Notified after every persisted settings change (next + previous snapshot). */
export type SettingsChangeListener = (next: AppSettings, previous: AppSettings) => void;

/**
 * User-tunable app settings, persisted in the app_state key/value table (key
 * 'settings'). Loaded once at boot and cached, so the hot path (the buy reading
 * `cursorMode`) is a synchronous in-memory read; `update` merges + persists +
 * refreshes the cache. Not a credential — stored plain (cf. the encrypted session
 * blob in the same table).
 */
@Injectable()
export class AppSettingsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AppSettingsService.name);
  private settings: AppSettings = { ...DEFAULT_APP_SETTINGS };
  /**
   * Change listeners (self-registered by feature services, e.g. DealWatchService
   * reconciling the cap on a `dealMaxWatches` change — one dependency direction,
   * no module cycle, mirroring the HitDecoratorRegistry pattern).
   */
  private readonly changeListeners: SettingsChangeListener[] = [];

  constructor(@Inject(DATABASE) private readonly database: SniperDatabase) {}

  onApplicationBootstrap(): void {
    const row = this.database.select().from(appState).where(eq(appState.key, SETTINGS_KEY)).get();
    if (row) this.settings = { ...DEFAULT_APP_SETTINGS, ...(row.value as Partial<AppSettings>) };
  }

  get(): AppSettings {
    return this.settings;
  }

  /** Register a post-update listener. Returns nothing — listeners live for the process. */
  onChange(listener: SettingsChangeListener): void {
    this.changeListeners.push(listener);
  }

  /** Merge a partial update, persist it, notify listeners, and return the full settings. */
  update(patch: Partial<AppSettings>): AppSettings {
    const previous = this.settings;
    this.settings = { ...this.settings, ...patch };
    const updatedAt = new Date().toISOString();
    this.database
      .insert(appState)
      .values({ key: SETTINGS_KEY, value: this.settings, updatedAt })
      .onConflictDoUpdate({ target: appState.key, set: { value: this.settings, updatedAt } })
      .run();
    for (const listener of this.changeListeners) {
      // A misbehaving listener must never break the settings write.
      try {
        listener(this.settings, previous);
      } catch (error) {
        this.logger.warn(`settings change listener failed: ${String(error)}`);
      }
    }
    return this.settings;
  }
}
