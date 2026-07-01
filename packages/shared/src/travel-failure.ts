/** Why a hideout travel failed — a stable, UI-mappable reason (never a raw string). */
export type TravelFailureReason = 'item_gone' | 'rate_limited' | 'forbidden' | 'unknown';

/**
 * Classify a failed GGG whisper/travel response into a stable reason. Registry-style —
 * add an observed `(httpStatus, gggCode)` rule, never touch callers. Only codes we've
 * ACTUALLY observed are mapped (hard rule #2 — evidence in `docs/integration/api-notes.md`);
 * anything unmapped stays `unknown` and the UI falls back to the raw detail. `gggCode` is
 * the trade-API error body's `error.code`.
 */
const RULES: ReadonlyArray<{
  reason: TravelFailureReason;
  match: (httpStatus: number | null, gggCode: number | null) => boolean;
}> = [
  { reason: 'rate_limited', match: (httpStatus) => httpStatus === 429 },
  { reason: 'item_gone', match: (httpStatus, gggCode) => httpStatus === 404 && gggCode === 1 },
  { reason: 'forbidden', match: (httpStatus, gggCode) => httpStatus === 403 && gggCode === 6 },
];

export function classifyTravelFailure(
  httpStatus: number | null,
  gggCode: number | null,
): TravelFailureReason {
  return RULES.find((rule) => rule.match(httpStatus, gggCode))?.reason ?? 'unknown';
}
