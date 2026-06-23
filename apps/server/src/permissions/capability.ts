import type { PermissionKind } from '@poe-sniper/shared';

/** What the app wants to DO — mapped to the OS permissions it requires. */
export type CapabilityKind = 'capture' | 'control';

/**
 * Capability → required permissions, as a table (open/closed: a new capability
 * is a new entry, never an if-chain). `control` (move/click) needs Accessibility
 * AND Screen Recording, because it must also see the screen to act on it.
 */
export const REQUIRED_PERMISSIONS: Record<CapabilityKind, PermissionKind[]> = {
  capture: ['screenRecording'],
  control: ['screenRecording', 'accessibility'],
};
