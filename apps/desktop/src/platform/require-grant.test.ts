import { describe, expect, it } from 'vitest';
import type { PermissionKind, PermissionProbe, PermissionState } from '@poe-sniper/server';
import { requireGrant } from './require-grant.js';

function probe(states: Partial<Record<PermissionKind, PermissionState>>): PermissionProbe {
  return {
    query: (kind) => states[kind] ?? 'unsupported',
    request: () => Promise.resolve(),
    openSettingsPane: () => {},
  };
}

describe('requireGrant (adapter self-gate, decision #3)', () => {
  it('passes when every required kind is granted', () => {
    const granted = probe({ screenRecording: 'granted', accessibility: 'granted' });
    expect(() =>
      requireGrant(granted, 'control', ['screenRecording', 'accessibility']),
    ).not.toThrow();
  });

  it('throws naming the missing kind', () => {
    const denied = probe({ screenRecording: 'granted', accessibility: 'denied' });
    expect(() => requireGrant(denied, 'control', ['screenRecording', 'accessibility'])).toThrow(
      /accessibility/,
    );
  });

  it('treats anything other than granted as missing (denied/not-determined/restricted/unsupported)', () => {
    for (const state of [
      'denied',
      'not-determined',
      'restricted',
      'unsupported',
    ] as PermissionState[]) {
      expect(() =>
        requireGrant(probe({ screenRecording: state }), 'capture', ['screenRecording']),
      ).toThrow();
    }
  });
});
