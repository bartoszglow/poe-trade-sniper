import { Inject, Injectable } from '@nestjs/common';
import { isGrant, type PermissionKind } from '@poe-sniper/shared';
import { PERMISSION_PROBE } from '../platform/platform.tokens.js';
import type { PermissionProbe } from '../platform/ports.js';
import { REQUIRED_PERMISSIONS, type CapabilityKind } from './capability.js';
import { PermissionDeniedError } from './permission-denied.error.js';

/**
 * The single enforcement point: may a capability run right now? Uses the shared
 * `isGrant` predicate (same as the UI) and reads live state, so a permission
 * revoked in System Settings immediately closes the gate.
 */
@Injectable()
export class PermissionGateService {
  constructor(@Inject(PERMISSION_PROBE) private readonly probe: PermissionProbe) {}

  private missing(capability: CapabilityKind): PermissionKind[] {
    return REQUIRED_PERMISSIONS[capability].filter((kind) => !isGrant(this.probe.query(kind)));
  }

  allows(capability: CapabilityKind): boolean {
    return this.missing(capability).length === 0;
  }

  /** Screen capture (Phase 2). */
  canCapture(): boolean {
    return this.allows('capture');
  }

  /** Cursor move / click (Phase 2). */
  canControl(): boolean {
    return this.allows('control');
  }

  /** Throw if the capability is not currently permitted. */
  assert(capability: CapabilityKind): void {
    const missing = this.missing(capability);
    if (missing.length > 0) throw new PermissionDeniedError(capability, missing);
  }
}
