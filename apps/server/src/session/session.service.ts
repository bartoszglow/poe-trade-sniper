import { Inject, Injectable } from '@nestjs/common';
import type { SessionPublicStatus, SessionState } from '@poe-sniper/shared';
import { SESSION_STORE, type SessionStore } from './session-store.js';

/** Shape of the prototype's `session-state.json` export (Playwright cookies). */
export interface PrototypeSessionExport {
  userAgent: string;
  cookies: Array<{ name: string; value: string; domain: string }>;
}

/**
 * Owns the PoE session lifecycle. SECURITY: cookie values never leave this
 * module except as the Cookie header handed to the trade-api adapter —
 * never logged, never serialized into API responses.
 */
@Injectable()
export class SessionService {
  /** Last /my-account probe result (set by the trade-api layer). */
  private probedValid: boolean | null = null;

  constructor(@Inject(SESSION_STORE) private readonly sessionStore: SessionStore) {}

  getSession(): SessionState | null {
    return this.sessionStore.load();
  }

  /** The Cookie request-header value for GGG calls. */
  buildCookieHeader(state: SessionState): string {
    return Object.entries(state.cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  /** Manual paste path: user supplies cookies copied from their own browser. */
  setFromCookies(cookies: Record<string, string>, userAgent: string): SessionPublicStatus {
    if (!cookies['POESESSID']) {
      throw new Error('POESESSID cookie is required');
    }
    const state: SessionState = {
      cookies,
      userAgent,
      capturedAt: new Date().toISOString(),
    };
    this.sessionStore.save(state);
    this.probedValid = null;
    return this.publicStatus();
  }

  /**
   * Bootstrap path: the prototype's session-state.json. Keeps only
   * pathofexile.com cookies; fixes the headless UA marker the export carries.
   */
  importFromPrototypeExport(exportPayload: PrototypeSessionExport): SessionPublicStatus {
    const poeCookies = exportPayload.cookies.filter((cookie) =>
      cookie.domain.endsWith('pathofexile.com'),
    );
    if (poeCookies.length === 0) {
      throw new Error('export contains no pathofexile.com cookies');
    }
    const cookies = Object.fromEntries(poeCookies.map((cookie) => [cookie.name, cookie.value]));
    return this.setFromCookies(
      cookies,
      exportPayload.userAgent.replace('HeadlessChrome', 'Chrome'),
    );
  }

  clear(): void {
    this.sessionStore.clear();
    this.probedValid = null;
  }

  markProbeResult(valid: boolean): void {
    this.probedValid = valid;
  }

  publicStatus(): SessionPublicStatus {
    const state = this.sessionStore.load();
    return {
      hasSession: state !== null,
      capturedAt: state?.capturedAt ?? null,
      cookieNames: state ? Object.keys(state.cookies).sort() : [],
      probedValid: this.probedValid,
    };
  }
}
