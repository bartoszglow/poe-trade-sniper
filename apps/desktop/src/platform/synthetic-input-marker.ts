/**
 * Shared marker coordinating the input controller and the uiohook watcher: the
 * controller timestamps each synthetic cursor step; the watcher ignores mouse
 * moves within the grace window of one, so our own automated moves don't
 * self-abort (the O-7 mitigation). Module-level singleton — both adapters live
 * in the same Electron main process.
 */
let lastSyntheticMoveAtMs = 0;

export function markSyntheticMove(): void {
  lastSyntheticMoveAtMs = Date.now();
}

export function isWithinSyntheticGrace(graceMs: number): boolean {
  return Date.now() - lastSyntheticMoveAtMs < graceMs;
}
