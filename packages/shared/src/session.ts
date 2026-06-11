/**
 * Captured PoE web session.
 *
 * SECURITY: this is a credential. It must never be logged, never sent to the
 * UI, and only persisted through the server's SessionStore.
 */
export interface SessionState {
  /** Full cookie set captured at login time (name → value). */
  cookies: Record<string, string>;
  /** User-Agent the cookies were issued under (must match on every request). */
  userAgent: string;
  /** ISO-8601 timestamp of capture. */
  capturedAt: string;
}

/** What the UI is allowed to know about the session. */
export interface SessionPublicStatus {
  loggedIn: boolean;
  capturedAt: string | null;
}
