import type { PurchaseMode } from '@poe-sniper/shared';
import type { SelectOption } from '../components/Select';

/**
 * Labels mirror the trade-site status dropdown. Modes without a verified
 * `status.option` mapping run with the query's own status (server warns) —
 * flagged here so the operator knows. Empty value = no override.
 */
export const PURCHASE_MODE_OPTIONS: SelectOption[] = [
  { value: '', label: 'Keep query status' },
  { value: 'instant', label: 'Instant Buyout' },
  { value: 'instant_and_in_person', label: 'Instant Buyout and In Person *' },
  { value: 'in_person_online_in_league', label: 'In Person (Online in League) *' },
  { value: 'in_person_online', label: 'In Person (Online) *' },
  { value: 'any', label: 'Any *' },
];

export const UNVERIFIED_MODE_HINT = '* mapping unverified — runs with the query’s own status';

export function toPurchaseMode(value: string): PurchaseMode | null {
  return value === '' ? null : (value as PurchaseMode);
}
