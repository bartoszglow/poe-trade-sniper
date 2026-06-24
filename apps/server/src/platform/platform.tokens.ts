/**
 * DI tokens for the desktop-platform ports. The real adapters live ONLY in
 * `apps/desktop`; the server depends on these tokens and a no-op default, so it
 * never imports a native addon.
 */
export const PERMISSION_PROBE = Symbol('PERMISSION_PROBE');
export const CAPTURE_SOURCE = Symbol('CAPTURE_SOURCE');
export const TRADE_VISION = Symbol('TRADE_VISION');
export const INPUT_CONTROLLER = Symbol('INPUT_CONTROLLER');
export const USER_INPUT_WATCHER = Symbol('USER_INPUT_WATCHER');
