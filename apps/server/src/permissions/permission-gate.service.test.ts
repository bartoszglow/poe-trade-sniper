import { describe, expect, it } from 'vitest';
import {
  describeState,
  isGrant,
  type PermissionKind,
  type PermissionState,
} from '@poe-sniper/shared';
import type { PermissionProbe } from '../platform/ports.js';
import { PermissionGateService } from './permission-gate.service.js';
import { PermissionsService } from './permissions.service.js';
import { PermissionDeniedError } from './permission-denied.error.js';

function probeWith(states: Partial<Record<PermissionKind, PermissionState>>): PermissionProbe {
  return {
    query: (kind) => states[kind] ?? 'unsupported',
    request: async () => {},
    openSettingsPane: () => {},
  };
}

describe('PermissionGateService', () => {
  it('allows a capability only when every required permission is granted', () => {
    const gate = new PermissionGateService(
      probeWith({ screenRecording: 'granted', accessibility: 'granted' }),
    );
    expect(gate.canCapture()).toBe(true);
    expect(gate.canControl()).toBe(true);
  });

  it('blocks control when one required permission is missing', () => {
    const gate = new PermissionGateService(
      probeWith({ screenRecording: 'granted', accessibility: 'denied' }),
    );
    expect(gate.canCapture()).toBe(true); // capture needs only screen recording
    expect(gate.canControl()).toBe(false);
  });

  it('assert throws PermissionDeniedError naming the missing permission(s)', () => {
    const gate = new PermissionGateService(
      probeWith({ screenRecording: 'denied', accessibility: 'denied' }),
    );
    try {
      gate.assert('control');
      expect.unreachable('assert should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PermissionDeniedError);
      expect((error as PermissionDeniedError).missing).toEqual([
        'screenRecording',
        'accessibility',
      ]);
    }
  });

  it('treats restricted (MDM) and unsupported as not granted', () => {
    expect(
      new PermissionGateService(
        probeWith({ screenRecording: 'restricted', accessibility: 'granted' }),
      ).canControl(),
    ).toBe(false);
    // non-darwin / no platform → everything unsupported → all gates closed
    expect(new PermissionGateService(probeWith({})).canControl()).toBe(false);
  });
});

describe('PermissionsService', () => {
  it('reports the live state of every permission kind', () => {
    const status = new PermissionsService(
      probeWith({ screenRecording: 'granted', accessibility: 'not-determined' }),
    ).status();
    expect(status).toEqual({ screenRecording: 'granted', accessibility: 'not-determined' });
  });
});

describe('shared permission predicates', () => {
  const allStates: PermissionState[] = [
    'granted',
    'denied',
    'restricted',
    'not-determined',
    'unsupported',
  ];

  it('isGrant passes only granted', () => {
    expect(isGrant('granted')).toBe(true);
    for (const state of allStates.filter((s) => s !== 'granted')) {
      expect(isGrant(state)).toBe(false);
    }
  });

  it('describeState marks only granted as granted, with sane severities', () => {
    expect(describeState('granted')).toEqual({ granted: true, severity: 'ok' });
    for (const state of allStates.filter((s) => s !== 'granted')) {
      expect(describeState(state).granted).toBe(false);
    }
    expect(describeState('denied').severity).toBe('danger');
    expect(describeState('unsupported').severity).toBe('muted');
  });
});
