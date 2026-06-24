import { describe, expect, it } from 'vitest';
import { PermissionGateService } from '../permissions/permission-gate.service.js';
import { PushedPermissionProbe } from './pushed-permission-probe.js';

describe('PushedPermissionProbe (dev↔prod parity)', () => {
  it('defaults every kind to unsupported until pushed', () => {
    const probe = new PushedPermissionProbe();
    expect(probe.query('screenRecording')).toBe('unsupported');
    expect(probe.query('accessibility')).toBe('unsupported');
  });

  it('reflects the pushed status', () => {
    const probe = new PushedPermissionProbe();
    probe.set({ screenRecording: 'granted', accessibility: 'denied' });
    expect(probe.query('screenRecording')).toBe('granted');
    expect(probe.query('accessibility')).toBe('denied');
  });

  it('makes the capability gate behave identically to packaged once status is pushed', () => {
    const probe = new PushedPermissionProbe();
    const gate = new PermissionGateService(probe);
    expect(gate.canControl()).toBe(false); // unsupported → closed (dev before a push)

    probe.set({ screenRecording: 'granted', accessibility: 'granted' });
    expect(gate.canControl()).toBe(true); // pushed grant → open, same as the in-process server
    expect(gate.canCapture()).toBe(true);

    probe.set({ screenRecording: 'granted', accessibility: 'denied' });
    expect(gate.canControl()).toBe(false); // revoke Accessibility → control closes
    expect(gate.canCapture()).toBe(true); // capture only needs Screen Recording
  });
});
