/**
 * Stable, UI-mappable reason behind a DEGRADED engine status — never a raw string
 * or error code. A code (not prose, not a WS close code, not an exception message)
 * crosses the wire; the web view maps it to a localized label, so the operator never
 * sees raw technical text. Non-degraded statuses may carry a free diagnostic detail —
 * it is logged but never rendered.
 *
 * Add an observed case here and a label in the view; never emit prose to the UI.
 */
export type EngineStatusDetailCode =
  | 'no-session' // no PoE session yet — live socket can't authenticate
  | 'guard-halted' // safety guard tripped — connections halted until reset
  | 'ws-rate-limited' // GGG told the live socket to back off (1013); poll covers
  | 'ws-reconnecting' // live socket dropped; reconnecting, poll covers meanwhile
  | 'rate-limited' // the rate governor is pausing polling
  | 'error'; // an unexpected engine error (raw detail stays in the logs)
