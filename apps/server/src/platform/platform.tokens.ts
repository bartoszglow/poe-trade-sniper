/**
 * DI tokens for the desktop-platform ports. The real adapters live ONLY in
 * `apps/desktop`; the server depends on these tokens and a no-op default, so it
 * never imports a native addon. Phase 2 adds CAPTURE_SOURCE / INPUT_CONTROLLER /
 * TRADE_VISION / USER_INPUT_WATCHER here.
 */
export const PERMISSION_PROBE = Symbol('PERMISSION_PROBE');
