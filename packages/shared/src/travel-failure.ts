/** Why a hideout travel failed — a stable, UI-mappable reason (never a raw string). */
export type TravelFailureReason =
  | 'item_gone'
  | 'not_in_game'
  | 'rate_limited'
  | 'server_error'
  | 'bad_response'
  | 'forbidden'
  | 'unknown';

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
  // The character isn't in-game (client at login/character-select, or PoE not
  // running) — GGG rejects the teleport. Observed 2026-07-07, evidence in
  // api-notes.md. Not retryable: only entering the game clears it.
  { reason: 'not_in_game', match: (httpStatus, gggCode) => httpStatus === 400 && gggCode === 2 },
  // GGG's official error-code enum (api-notes.md, fetched 2026-07-07). GGG says
  // "use the code rather than the message", so these match on the code alone —
  // the exact HTTP status pairing per endpoint isn't whisper-confirmed yet.
  { reason: 'rate_limited', match: (_httpStatus, gggCode) => gggCode === 3 }, // Rate limit exceeded
  { reason: 'server_error', match: (_httpStatus, gggCode) => gggCode === 4 }, // Internal error
  { reason: 'bad_response', match: (_httpStatus, gggCode) => gggCode === 5 }, // Unexpected content type
];

/**
 * Reasons worth exactly ONE automatic retry — transient or indeterminate, where
 * re-resolving a fresh token and travelling again can plausibly succeed. The
 * definitive ones are excluded: `item_gone` (sold), `not_in_game` (needs the
 * operator in-game), `rate_limited` (retrying worsens it), `forbidden` (a config
 * fault). `unknown`/`null` stay retryable as the safe default for the unseen.
 */
const RETRYABLE_REASONS: ReadonlySet<TravelFailureReason> = new Set([
  'unknown',
  'server_error',
  'bad_response',
]);

export function isRetryableTravelFailure(reason: TravelFailureReason | null): boolean {
  return reason === null || RETRYABLE_REASONS.has(reason);
}

export function classifyTravelFailure(
  httpStatus: number | null,
  gggCode: number | null,
): TravelFailureReason {
  return RULES.find((rule) => rule.match(httpStatus, gggCode))?.reason ?? 'unknown';
}
