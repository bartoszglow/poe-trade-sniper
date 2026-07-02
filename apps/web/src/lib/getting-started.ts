/**
 * "Getting started" checklist derivation (#36 phase 2, D-onb-2): the three
 * steps of the real first-run funnel, derived purely from existing state — no
 * bookkeeping of its own, so it can never disagree with reality.
 */
export interface GettingStartedProgress {
  sessionConnected: boolean;
  firstSearchAdded: boolean;
  firstHitReceived: boolean;
  allDone: boolean;
}

export function deriveGettingStarted(input: {
  /** A stored session that has not failed the probe. */
  hasValidSession: boolean;
  /** Watched searches, archived included — the user has been through the flow. */
  searchCount: number;
  /** Persisted detections across all searches (survives restarts). */
  totalHitCount: number;
}): GettingStartedProgress {
  const sessionConnected = input.hasValidSession;
  const firstSearchAdded = input.searchCount > 0;
  const firstHitReceived = input.totalHitCount > 0;
  return {
    sessionConnected,
    firstSearchAdded,
    firstHitReceived,
    allDone: sessionConnected && firstSearchAdded && firstHitReceived,
  };
}
