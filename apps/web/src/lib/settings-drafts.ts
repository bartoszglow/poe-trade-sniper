/**
 * Seed anchor for the settings card's drafts (plan 42 review). The card
 * lazy-mounts with the panel and seeds its label/id drafts once — but the row
 * identity can change UNDER the mounted card: disabling deal mode restores or
 * re-mints the original id, and a save re-points the row. A stale id draft
 * after such a transition would silently re-point the search to a dead
 * auto-derived id on the next label-only save.
 */

export interface SettingsDraftAnchor {
  id: string;
  dealManaged: boolean;
}

/** True when the drafts must re-seed from the row (identity transition). */
export function draftsNeedReseed(
  anchor: SettingsDraftAnchor,
  current: SettingsDraftAnchor,
): boolean {
  return anchor.id !== current.id || anchor.dealManaged !== current.dealManaged;
}
