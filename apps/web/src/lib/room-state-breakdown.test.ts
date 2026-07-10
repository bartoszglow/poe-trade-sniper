import { describe, expect, it } from 'vitest';
import type { EngineStatus, SearchRuntimeInfo } from '@poe-sniper/shared';
import { roomHasHealthConcern, roomStateBreakdown } from './room-state-breakdown';

function member(status: EngineStatus): SearchRuntimeInfo {
  return { status } as SearchRuntimeInfo;
}

const ALL_STATUSES: EngineStatus[] = [
  'pending',
  'connecting',
  'active',
  'degraded',
  'halted',
  'stopped',
  'paused',
];

describe('roomStateBreakdown', () => {
  it('counts each state, folds pending+connecting into starting, keeps registry order', () => {
    const result = roomStateBreakdown([
      member('active'),
      member('active'),
      member('pending'),
      member('connecting'),
      member('degraded'),
      member('halted'),
      member('paused'),
      member('stopped'),
    ]);
    expect(result.map((bucket) => [bucket.id, bucket.count])).toEqual([
      ['active', 2],
      ['starting', 2],
      ['degraded', 1],
      ['halted', 1],
      ['paused', 1],
      ['stopped', 1],
    ]);
  });

  it('omits zero buckets', () => {
    const result = roomStateBreakdown([member('active'), member('paused')]);
    expect(result.map((bucket) => bucket.id)).toEqual(['active', 'paused']);
  });

  it('partitions EngineStatus exhaustively — counts always sum to member count', () => {
    const members = ALL_STATUSES.map(member);
    const total = roomStateBreakdown(members).reduce((sum, bucket) => sum + bucket.count, 0);
    expect(total).toBe(members.length);
  });

  it('flags a health concern only for degraded/halted members', () => {
    expect(roomHasHealthConcern([member('active'), member('paused')])).toBe(false);
    expect(roomHasHealthConcern([member('active'), member('degraded')])).toBe(true);
    expect(roomHasHealthConcern([member('halted')])).toBe(true);
  });
});
