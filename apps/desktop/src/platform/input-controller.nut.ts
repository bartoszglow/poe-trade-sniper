import { Key, keyboard, mouse, Point as NutPoint } from '@nut-tree-fork/nut-js';
import type { InputController, KeyName, PermissionProbe, Point } from '@poe-sniper/server';
import { requireGrant } from './require-grant.js';
import { markSyntheticKey, markSyntheticMove } from './synthetic-input-marker.js';

// NOTE: Key.Enter (103) is the NUMPAD enter, which PoE chat ignores — chat opens/sends
// on the MAIN Return key (Key.Return = 83). Mapping 'enter' to the wrong one was why the
// /hideout sequence silently did nothing after Esc.
const KEY_MAP: Record<KeyName, Key> = { escape: Key.Escape, enter: Key.Return };
// Deterministic, not-too-fast key timing. A near-instant press+release was unreliable:
// Esc landed ~3/4 of the time and Enter never opened chat. We set a small base delay
// AND hold each key down explicitly so the game registers it.
keyboard.config.autoDelayMs = 24;
const KEY_HOLD_MS = 60; // hold a key down this long before releasing
const KEY_CHAR_DELAY_MS = 40; // gap between typed chars (the chat input drops faster bursts)

const MOVE_STEPS = 24;
/** Instant placement re-asserts the target this many times (a single setPosition
 *  can be dropped under main-thread load), spaced by PLACE_RETRY_MS. */
const PLACE_ATTEMPTS = 3;
const PLACE_RETRY_MS = 40;

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

    async placeCursor(to: Point): Promise<void> {
      requireGrant(probe, 'control', ['screenRecording', 'accessibility']);
      // Absolute placement, RE-ASSERTED a few times: under the in-process
      // dev:desktop main-thread load (and the System Events contention around
      // focus) a single setPosition is sometimes dropped, leaving the cursor
      // where it was. Re-setting the same absolute target is idempotent and cheap,
      // and makes the placement reliable. `getPosition` reads one step stale here,
      // so we don't gate on it — we just re-assert.
      const target = new NutPoint(Math.round(to.x), Math.round(to.y));
      for (let attempt = 0; attempt < PLACE_ATTEMPTS; attempt += 1) {
        markSyntheticMove();
        await mouse.setPosition(target);
        if (attempt < PLACE_ATTEMPTS - 1) {
          await new Promise((resolve) => setTimeout(resolve, PLACE_RETRY_MS));
        }
      }
    },

    async pressKey(key: KeyName): Promise<void> {
      requireGrant(probe, 'control', ['screenRecording', 'accessibility']);
      const nutKey = KEY_MAP[key] ?? Key.Escape;
      // HOLD the key: press → wait → release. A near-instant tap was unreliable.
      // Mark synthetic before BOTH events so the keydown (and any late delivery)
      // stays inside the abort-watcher's grace.
      markSyntheticKey();
      await keyboard.pressKey(nutKey);
      await new Promise((resolve) => setTimeout(resolve, KEY_HOLD_MS));
      markSyntheticKey();
      await keyboard.releaseKey(nutKey);
    },

    async typeText(text: string): Promise<void> {
      requireGrant(probe, 'control', ['screenRecording', 'accessibility']);
      // One char at a time with a small gap — typing the whole string at once was too
      // fast for the chat input. Mark synthetic before each so the keydowns are graced
      // (the watcher fires on any un-graced keydown).
      for (const char of text) {
        markSyntheticKey();
        await keyboard.type(char);
        await new Promise((resolve) => setTimeout(resolve, KEY_CHAR_DELAY_MS));
      }
    },
  };
}
