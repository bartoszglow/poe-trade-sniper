import { Inject, Injectable } from '@nestjs/common';
import { PERMISSION_KINDS, type PermissionsStatus } from '@poe-sniper/shared';
import { PERMISSION_PROBE } from '../platform/platform.tokens.js';
import type { PermissionProbe } from '../platform/ports.js';

/**
 * Reads live OS permission state for the UI. No `revoke` method exists — macOS
 * permissions are OS-controlled (Option A): the app only reflects + requests.
 */
@Injectable()
export class PermissionsService {
  // Explicit @Inject — tsx/esbuild emits no decorator metadata (D-11).
  constructor(@Inject(PERMISSION_PROBE) private readonly probe: PermissionProbe) {}

  status(): PermissionsStatus {
    return Object.fromEntries(
      PERMISSION_KINDS.map((kind) => [kind, this.probe.query(kind)]),
    ) as PermissionsStatus;
  }
}
