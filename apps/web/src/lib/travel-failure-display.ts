import type { TravelFailureReason } from '@poe-sniper/shared';
import type { MessageKey } from '../i18n/messages';

export interface FailureDisplay {
  /** i18n key for the friendly, localized label. */
  key: MessageKey;
  /** Tailwind text-color class for the label's tone. */
  tone: string;
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
  rate_limited: { key: 'hitCard.travelRateLimited', tone: 'text-gold' },
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
