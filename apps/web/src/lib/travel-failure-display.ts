import type { TravelFailureReason } from '@poe-sniper/shared';
import type { MessageKey } from '../i18n/messages';

export interface FailureDisplay {
  /** i18n key for the friendly, localized label. */
  key: MessageKey;
  /** Tailwind text-color class for the label's tone. */
  tone: string;
  /** Optional i18n key for a short on-hover explanation (rendered as a title). */
  hintKey?: MessageKey;
}

/**
 * A failed travel's stable GGG reason → a friendly localized label + tone. A sold
 * item ('item_gone') is muted, not alarming — expected in a fast market; a rate-limit
 * is gold (actionable). Only reasons we've mapped appear; anything else falls back to
 * the plain red "failed".
 *
 * The one shared home for this mapping — reused by live hits (HitCard) AND the Activity
 * timeline so the two never diverge, and so the raw server `detail` is NEVER surfaced
 * anywhere (hard rule: translate errors, never show raw). The server-side counterpart
 * that reduces a raw error to the enum is `classifyTravelFailure` in @poe-sniper/shared.
 */
const TRAVEL_FAILURE_DISPLAY: Partial<Record<TravelFailureReason, FailureDisplay>> = {
  item_gone: { key: 'hitCard.travelGone', tone: 'text-ink-muted' },
  // Actionable (enter the game, then retry) — amber, not the dead-end muted grey.
  not_in_game: {
    key: 'hitCard.travelNotInGame',
    tone: 'text-warn',
    hintKey: 'hitCard.travelNotInGameHint',
  },
  // In-game but on a map — must be in a town/hideout to travel. Actionable → amber.
  not_in_town: {
    key: 'hitCard.travelNotInTown',
    tone: 'text-warn',
    hintKey: 'hitCard.travelNotInTownHint',
  },
  // Your own listing — can't buy from yourself. Muted (nothing to act on).
  own_listing: {
    key: 'hitCard.travelOwnListing',
    tone: 'text-ink-muted',
    hintKey: 'hitCard.travelOwnListingHint',
  },
  rate_limited: { key: 'hitCard.travelRateLimited', tone: 'text-gold' },
  // 403 / gggCode 6 — a session or config fault (not retryable). Danger, hint on hover.
  forbidden: {
    key: 'hitCard.travelForbidden',
    tone: 'text-danger',
    hintKey: 'hitCard.travelForbiddenHint',
  },
  // Transient GGG faults (codes 4/5) — auto-retried once; amber, hint on hover.
  server_error: {
    key: 'hitCard.travelServerError',
    tone: 'text-warn',
    hintKey: 'hitCard.travelServerErrorHint',
  },
  bad_response: {
    key: 'hitCard.travelBadResponse',
    tone: 'text-warn',
    hintKey: 'hitCard.travelBadResponseHint',
  },
};

/** Friendly label + tone for a (possibly null/unmapped) travel failure reason. */
export function travelFailureDisplay(
  reason: TravelFailureReason | null | undefined,
): FailureDisplay {
  return (
    (reason ? TRAVEL_FAILURE_DISPLAY[reason] : undefined) ?? {
      key: 'hitCard.failed',
      tone: 'text-danger',
    }
  );
}
