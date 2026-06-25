import type { ItemDetail, ListingPrice } from './item.js';

/** Which sub-action of a travel sequence a step belongs to. */
export type ActivityStepKind = 'travel' | 'buy' | 'return';

/**
 * One atomic step within an activity — a single travel/buy/return event, with the
 * raw phase (e.g. travel 'success', buy 'item-located'/'moved'/'failed', return
 * 'returned') plus its time and detail/reason.
 */
export interface ActivityStep {
  kind: ActivityStepKind;
  phase: string;
  at: string;
  detail: string | null;
}

/**
 * Derived headline outcome of an activity (the buy result; the return is tracked
 * separately by `returnedHome`).
 *  - in-progress: still running
 *  - travel-failed: the teleport itself failed
 *  - no-shop: arrived but the trade window never opened
 *  - item-sold: shop opened but the item was gone
 *  - placed: cursor moved onto the item (success — there is no click yet, D-8)
 *  - aborted: operator moved the mouse / pressed a key mid-run
 *  - unsupported: platform/capability can't run the buy
 *  - failed: other buy failure (focus-failed, permission, timeout, …) — see step detail
 */
export type ActivityOutcome =
  | 'in-progress'
  | 'travel-failed'
  | 'no-shop'
  | 'item-sold'
  | 'placed'
  | 'aborted'
  | 'unsupported'
  | 'failed';

/**
 * One travel→buy→return sequence the app performed, with a self-contained snapshot
 * of the item (so the record survives hit-pruning) and the ordered atomic steps.
 * NEVER carries the session or hideout token (hard rule #3).
 */
export interface ActivityRecord {
  id: string;
  searchId: string | null;
  listingId: string | null;
  source: 'manual' | 'auto';
  /** Item snapshot, taken from the hit at travel time. */
  itemName: string;
  price: ListingPrice | null;
  seller: string | null;
  item: ItemDetail | null;
  startedAt: string;
  finishedAt: string | null;
  outcome: ActivityOutcome;
  /** Whether we made it back to our hideout: true/false once the return ran, else null. */
  returnedHome: boolean | null;
  steps: ActivityStep[];
}
