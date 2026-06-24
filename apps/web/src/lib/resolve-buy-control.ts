import type { MessageKey } from '../i18n/messages';

/** Resolved presentational state of a row's Buy toggle (SearchRow stays dumb). */
export interface BuyControl {
  /** Toggle interactive (macOS desktop + control granted). */
  enabled: boolean;
  /** Reflects autoBuy && canControl — a revoked permission shows off + disabled. */
  checked: boolean;
  /** Inline reason the toggle is disabled, or null when live. */
  note: MessageKey | null;
}

/**
 * Ordered resolver (first match wins) — composition over nested ternaries.
 * Decision #2=B: Buy needs macOS desktop + the control permission. It is
 * INDEPENDENT of the Travel toggle (D-19) — it triggers on any travel success
 * (auto or manual), so it needs no Travel opt-in here.
 */
export function resolveBuyControl(args: {
  isDesktop: boolean;
  isMac: boolean;
  canControl: boolean;
  autoBuy: boolean;
}): BuyControl {
  if (!args.isDesktop) return { enabled: false, checked: false, note: 'searches.buyWebOnly' };
  if (!args.isMac) return { enabled: false, checked: false, note: 'searches.buyUnsupportedOs' };
  if (!args.canControl) {
    return { enabled: false, checked: false, note: 'searches.buyNeedsPermission' };
  }
  return { enabled: true, checked: args.autoBuy, note: null };
}
