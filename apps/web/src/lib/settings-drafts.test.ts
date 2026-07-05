import { describe, expect, it } from 'vitest';
import { draftsNeedReseed } from './settings-drafts';

describe('draftsNeedReseed', () => {
  it('re-seeds when disabling deal mode restores the original id', () => {
    // Card mounted while deal mode was on: drafts hold the AUTO derived id.
    const anchor = { id: 'derivedAutoId', dealManaged: true };
    // Disable restores the original id and unlocks the input — a stale draft
    // would re-point the search to the retired auto id on a label-only save.
    expect(draftsNeedReseed(anchor, { id: 'originalId', dealManaged: false })).toBe(true);
  });

  it('re-seeds when a save re-points the row (id change, deal off)', () => {
    expect(
      draftsNeedReseed({ id: 'oldId', dealManaged: false }, { id: 'newId', dealManaged: false }),
    ).toBe(true);
  });

  it('re-seeds on the deal enable transition even when the id is unchanged yet', () => {
    expect(
      draftsNeedReseed({ id: 'same', dealManaged: false }, { id: 'same', dealManaged: true }),
    ).toBe(true);
  });

  it('keeps mid-edit drafts while nothing transitioned (SSE refetches)', () => {
    expect(
      draftsNeedReseed({ id: 'same', dealManaged: true }, { id: 'same', dealManaged: true }),
    ).toBe(false);
  });
});
