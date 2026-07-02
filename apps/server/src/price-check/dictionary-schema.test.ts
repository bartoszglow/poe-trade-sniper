import { describe, expect, it } from 'vitest';
import {
  DICTIONARY_SCHEMA_VERSION,
  diffDictionary,
  needsRebuild,
  summarizeDiff,
  type TradeDictionary,
} from './dictionary-schema.js';

function dict(overrides: Partial<TradeDictionary> = {}): TradeDictionary {
  return {
    meta: {
      schemaVersion: DICTIONARY_SCHEMA_VERSION,
      dataVersion: '2026-07-03',
      realm: 'poe2',
      league: 'Standard',
      fetchedAt: '2026-07-03T00:00:00.000Z',
      counts: { stats: 0, items: 0, statics: 0 },
    },
    stats: [],
    items: [],
    statics: [],
    ...overrides,
  };
}

const STAT = (id: string, text: string) => ({
  id,
  text,
  type: 'explicit',
  placeholders: 1,
  options: [],
});
const ITEM = (key: string) => ({
  key,
  name: key,
  baseType: key,
  category: null,
  flags: { unique: false, gem: false },
});

describe('diffDictionary', () => {
  it('reports added / removed / changed keyed by id, and identical when equal', () => {
    const before = dict({
      stats: [STAT('s1', '+# to Life'), STAT('s2', '+# to Mana')],
      items: [ITEM('gold ring')],
    });
    const after = dict({
      stats: [STAT('s1', '+# to maximum Life'), STAT('s3', '+#% Fire Res')],
      items: [ITEM('gold ring'), ITEM('sapphire ring')],
    });
    const diff = diffDictionary(before, after);
    expect(diff.stats.added.map((stat) => stat.id)).toEqual(['s3']);
    expect(diff.stats.removed.map((stat) => stat.id)).toEqual(['s2']);
    expect(diff.stats.changed.map((change) => change.after.id)).toEqual(['s1']);
    expect(diff.items.added.map((item) => item.key)).toEqual(['sapphire ring']);
    expect(diff.identical).toBe(false);
  });

  it('is identical when nothing changed', () => {
    const snapshot = dict({ stats: [STAT('s1', '+# to Life')] });
    expect(diffDictionary(snapshot, snapshot).identical).toBe(true);
  });

  it('treats a null baseline as everything-added (first build)', () => {
    const diff = diffDictionary(null, dict({ stats: [STAT('s1', 'x')] }));
    expect(diff.stats.added).toHaveLength(1);
    expect(diff.identical).toBe(false);
  });

  it('flags a schema-version change for a full rebuild', () => {
    const before = dict();
    const after = dict({ meta: { ...before.meta, schemaVersion: before.meta.schemaVersion + 1 } });
    expect(diffDictionary(before, after).schemaChanged).toBe(true);
  });

  it('summarizes counts', () => {
    const diff = diffDictionary(
      dict({ stats: [STAT('s1', 'a'), STAT('s2', 'b')] }),
      dict({ stats: [STAT('s2', 'b'), STAT('s3', 'c')] }),
    );
    expect(summarizeDiff(diff)).toBe('stats +1/-1/~0, items +0/-0/~0, static +0/-0/~0');
  });
});

describe('needsRebuild', () => {
  const now = new Date('2026-07-03T00:00:00.000Z').getTime();
  it('rebuilds when absent, schema-mismatched, or aged out', () => {
    expect(needsRebuild(null, now, 1000)).toBe(true);
    const oldSchema = dict({ meta: { ...dict().meta, schemaVersion: 0 } });
    expect(needsRebuild(oldSchema, now, 1000)).toBe(true);
    const stale = dict({ meta: { ...dict().meta, fetchedAt: '2026-06-01T00:00:00.000Z' } });
    expect(needsRebuild(stale, now, 1000)).toBe(true);
  });

  it('keeps a current, fresh dictionary', () => {
    const fresh = dict({ meta: { ...dict().meta, fetchedAt: new Date(now - 500).toISOString() } });
    expect(needsRebuild(fresh, now, 10_000)).toBe(false);
  });
});
