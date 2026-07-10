import type { EngineStatus, SearchRuntimeInfo } from '@poe-sniper/shared';
import type { BadgeTone } from '../components/Badge';
import type { MessageKey } from '../i18n/messages';

/** A stable id for one bucket of the room-header state breakdown. */
export type RoomStateId = 'active' | 'starting' | 'degraded' | 'halted' | 'paused' | 'stopped';

interface RoomStateBucket {
  id: RoomStateId;
  tone: BadgeTone;
  labelKey: MessageKey;
  /** Health buckets (degraded/halted) are the click-to-open, attention ones. */
  health: boolean;
  match: (status: EngineStatus) => boolean;
}

/**
 * The phase → bucket registry (plan 44). Ordered good-news-first; EXHAUSTIVE
 * over EngineStatus (pending+connecting fold into `starting`) — the assertion in
 * `roomStateBreakdown` fails the build if a new status has no bucket.
 */
const BUCKETS: readonly RoomStateBucket[] = [
  {
    id: 'active',
    tone: 'ok',
    labelKey: 'roomState.active',
    health: false,
    match: (s) => s === 'active',
  },
  {
    id: 'starting',
    tone: 'info',
    labelKey: 'roomState.starting',
    health: false,
    match: (s) => s === 'pending' || s === 'connecting',
  },
  {
    id: 'degraded',
    tone: 'warn',
    labelKey: 'roomState.degraded',
    health: true,
    match: (s) => s === 'degraded',
  },
  {
    id: 'halted',
    tone: 'danger',
    labelKey: 'roomState.halted',
    health: true,
    match: (s) => s === 'halted',
  },
  {
    id: 'paused',
    tone: 'info',
    labelKey: 'roomState.paused',
    health: false,
    match: (s) => s === 'paused',
  },
  {
    id: 'stopped',
    tone: 'neutral',
    labelKey: 'roomState.stopped',
    health: false,
    match: (s) => s === 'stopped',
  },
];

export interface RoomStateCount {
  id: RoomStateId;
  count: number;
  tone: BadgeTone;
  labelKey: MessageKey;
  health: boolean;
}

/**
 * Per-state member counts for a room header — only the non-zero buckets, in the
 * registry order. Each member lands in exactly one bucket (the buckets partition
 * EngineStatus), so the counts always sum to `members.length`.
 */
export function roomStateBreakdown(members: readonly SearchRuntimeInfo[]): RoomStateCount[] {
  const counts = new Map<RoomStateId, number>();
  for (const member of members) {
    const bucket = BUCKETS.find((candidate) => candidate.match(member.status));
    // Every EngineStatus has a bucket (exhaustive registry) — an unmatched one is
    // a new status added without a bucket, a real gap, so surface it loudly.
    if (!bucket) throw new Error(`unbucketed search status: ${member.status}`);
    counts.set(bucket.id, (counts.get(bucket.id) ?? 0) + 1);
  }
  return BUCKETS.filter((bucket) => (counts.get(bucket.id) ?? 0) > 0).map((bucket) => ({
    id: bucket.id,
    count: counts.get(bucket.id) ?? 0,
    tone: bucket.tone,
    labelKey: bucket.labelKey,
    health: bucket.health,
  }));
}

/** True when the room has a member needing attention (degraded/halted) — drives
 *  the click-to-open affordance on the collapsed header. */
export function roomHasHealthConcern(members: readonly SearchRuntimeInfo[]): boolean {
  return members.some((member) => member.status === 'degraded' || member.status === 'halted');
}
