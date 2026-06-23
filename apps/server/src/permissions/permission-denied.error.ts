import type { PermissionKind } from '@poe-sniper/shared';
import type { CapabilityKind } from './capability.js';

/**
 * Thrown at the resource boundary (inside the desktop port adapters) when a
 * gated action runs without its OS permission — so gating is a structural
 * guarantee, not a convention a caller can forget.
 */
export class PermissionDeniedError extends Error {
  constructor(
    readonly capability: CapabilityKind,
    readonly missing: PermissionKind[],
  ) {
    super(`capability "${capability}" denied — missing permission(s): ${missing.join(', ')}`);
    this.name = 'PermissionDeniedError';
  }
}
