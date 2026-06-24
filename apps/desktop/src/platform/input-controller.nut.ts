import { mouse, Point as NutPoint } from '@nut-tree-fork/nut-js';
import type { InputController, PermissionProbe, Point } from '@poe-sniper/server';
import { requireGrant } from './require-grant.js';
import { markSyntheticMove } from './synthetic-input-marker.js';

const MOVE_STEPS = 24;

/** Eased acceleration/deceleration — a straight constant-speed glide reads robotic. */
function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}
function jitter(): number {
  return (Math.random() - 0.5) * 2; // ±1px wobble
}
function stepDelayMs(): number {
  return 3 + Math.random() * 4; // 3–7ms per step (~3× faster than before, still eased)
}
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('aborted'));
      },
      { once: true },
    );
  });
}

/**
 * Human-like cursor MOVE via nut.js — an eased path with sub-pixel jitter and
 * randomized per-step delays, checking the AbortSignal each step so a real user
 * move stops it at once. Each synthetic step is timestamped so the uiohook
 * watcher can tell our moves from the user's. NO click (decision #8).
 * Self-gates Screen Recording + Accessibility (decision #3).
 */
export function createNutInputController(probe: PermissionProbe): InputController {
  return {
    async moveHumanLike(to: Point, signal: AbortSignal): Promise<void> {
      requireGrant(probe, 'control', ['screenRecording', 'accessibility']);
      const start = await mouse.getPosition();
      for (let step = 1; step <= MOVE_STEPS; step += 1) {
        if (signal.aborted) throw new Error('aborted');
        const progress = easeInOut(step / MOVE_STEPS);
        const x = Math.round(start.x + (to.x - start.x) * progress + jitter());
        const y = Math.round(start.y + (to.y - start.y) * progress + jitter());
        markSyntheticMove();
        await mouse.setPosition(new NutPoint(x, y));
        await sleep(stepDelayMs(), signal);
      }
      markSyntheticMove();
      await mouse.setPosition(new NutPoint(to.x, to.y));
    },
  };
}
