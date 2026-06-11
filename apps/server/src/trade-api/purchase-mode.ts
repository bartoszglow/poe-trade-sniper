import type { PurchaseMode } from '@poe-sniper/shared';

/**
 * Domain PurchaseMode → trade query `status.option`. Only `instant` is
 * verified; the rest stay null until captured live (no-guessing rule —
 * see docs/integration/api-notes.md "Purchase type").
 */
export const PURCHASE_MODE_TO_STATUS_OPTION: Record<PurchaseMode, string | null> = {
  instant: 'securable',
  instant_and_in_person: null, // TODO(verify)
  in_person_online_in_league: null, // TODO(verify)
  in_person_online: null, // TODO(verify)
  any: null, // TODO(verify)
};

export interface PurchaseModeApplication {
  query: unknown;
  /** False = unverified mapping; the resolved query's own status was kept. */
  applied: boolean;
}

/** Overrides the query's status for verified mappings; passthrough otherwise. */
export function applyPurchaseMode(
  query: unknown,
  mode: PurchaseMode | null,
): PurchaseModeApplication {
  if (mode === null) return { query, applied: true };
  const statusOption = PURCHASE_MODE_TO_STATUS_OPTION[mode];
  if (statusOption === null) return { query, applied: false };
  return {
    query: { ...(query as Record<string, unknown>), status: { option: statusOption } },
    applied: true,
  };
}
