/**
 * Shared marker coordinating the input controller and the uiohook watcher: the
 * controller timestamps each synthetic input; the watcher ignores events within
 * the grace window of one, so our own automation doesn't self-abort (the O-7
 * mitigation). Module-level singleton — both adapters live in the same Electron
 * main process.
 *
 * MOVE and KEY are tracked separately on purpose: a synthetic mouse MOVE must not
 * grace a real KEYDOWN (and vice-versa), or a genuine keypress during cursor
 * placement would be silently ignored. The controller marks a synthetic key
 * before EACH key it sends (incl. every char of typed text), so the grace only
 * has to cover the uiohook delivery lag.
 */
let lastSyntheticMoveAtMs = 0;
let lastSyntheticKeyAtMs = 0;

export function markSyntheticMove(): void {
  lastSyntheticMoveAtMs = Date.now();
}

export function isWithinSyntheticGrace(graceMs: number): boolean {
  return Date.now() - lastSyntheticMoveAtMs < graceMs;
}

export function markSyntheticKey(): void {
  lastSyntheticKeyAtMs = Date.now();
}

export function isWithinSyntheticKeyGrace(graceMs: number): boolean {
  return Date.now() - lastSyntheticKeyAtMs < graceMs;
}
