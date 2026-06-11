import type { SessionState } from '@poe-sniper/shared';

/**
 * The seam between "what a session is" and "where it lives" (D-7: plain DB
 * row until Phase 4, when encrypted stores slot in behind this interface).
 */
export interface SessionStore {
  load(): SessionState | null;
  save(state: SessionState): void;
  clear(): void;
}

export const SESSION_STORE = Symbol('SESSION_STORE');
