import { describe, expect, it, vi } from 'vitest';
import type { BuyAutomationEvent, TravelEvent } from '@poe-sniper/shared';
import { loadConfig } from '../config/env.js';
import { RealtimeBus } from '../events/realtime-bus.js';
import type {
  CaptureSource,
  InputController,
  Point,
  TradeVision,
  UserInputWatcher,
  WindowRegion,
} from '../platform/ports.js';
import { PermissionDeniedError } from '../permissions/permission-denied.error.js';
import type { PermissionGateService } from '../permissions/permission-gate.service.js';
import type { SearchManager } from '../search/search-manager.js';
import { BuyAutomationService } from './buy-automation.service.js';

const REGION: WindowRegion = { x: 0, y: 0, width: 100, height: 100 };
const POINT: Point = { x: 10, y: 20 };

function travelSuccess(overrides: Partial<TravelEvent> = {}): TravelEvent {
  return {
    type: 'travel',
    phase: 'success',
    source: 'auto',
    searchId: 's1',
    listingId: 'l1',
    itemName: 'Item',
    detail: null,
    at: '2026-06-24T00:00:00.000Z',
    ...overrides,
  };
}

/** Deterministic poll — avoids coupling to a specific vitest waitFor API. */
async function waitFor(predicate: () => boolean, timeoutMs = 1500): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

interface HarnessOptions {
  autoBuy?: boolean;
  canControl?: boolean;
  allowAssert?: boolean;
  focused?: boolean;
  region?: WindowRegion | null;
  point?: Point | null;
  captureHangs?: boolean;
  moveImpl?: (to: Point, signal: AbortSignal) => Promise<void>;
}

function createHarness(options: HarnessOptions = {}) {
  const bus = new RealtimeBus();
  const buyEvents: BuyAutomationEvent[] = [];
  bus.subscribe((event) => {
    if (event.type === 'buy') buyEvents.push(event);
  });

  const searchManager = {
    isAutoBuyEnabled: () => options.autoBuy ?? true,
  } as unknown as SearchManager;

  const gate = {
    canControl: () => options.canControl ?? true,
    assert: () => {
      if (!(options.allowAssert ?? true))
        throw new PermissionDeniedError('control', ['accessibility']);
    },
  } as unknown as PermissionGateService;

  const capture = {
    capture: vi.fn(() =>
      options.captureHangs
        ? new Promise<never>(() => {}) // never resolves — exercises the run deadline
        : Promise.resolve({ width: 1, height: 1, pixels: new Uint8Array(4) }),
    ),
    focusGameWindow: vi.fn(() => Promise.resolve(true)),
    isGameWindowFocused: vi.fn(() => Promise.resolve(options.focused ?? true)),
  } as unknown as CaptureSource;

  const region = options.region === undefined ? REGION : options.region;
  const point = options.point === undefined ? POINT : options.point;
  const vision = {
    detectTradeWindow: vi.fn(() => Promise.resolve(region)),
    locateItem: vi.fn(() => Promise.resolve(point)),
  } as unknown as TradeVision;

  const moveHumanLike = vi.fn(options.moveImpl ?? (() => Promise.resolve()));
  const input = { moveHumanLike } as unknown as InputController;

  let inputCallback: (() => void) | null = null;
  const userInput: UserInputWatcher = {
    onRealInput: (callback: () => void) => {
      inputCallback = callback;
      return () => {
        inputCallback = null;
      };
    },
  };

  const config = loadConfig({
    BUY_FOCUS_VERIFY_MS: '0',
    BUY_CAPTURE_POLL_MS: '20',
    BUY_CAPTURE_TIMEOUT_MS: '500',
    BUY_RUN_TIMEOUT_MS: '2000',
  });
  const service = new BuyAutomationService(
    config,
    bus,
    searchManager,
    gate,
    capture,
    vision,
    input,
    userInput,
  );
  service.onApplicationBootstrap();

  return {
    bus,
    service,
    buyEvents,
    moveHumanLike,
    phases: () => buyEvents.map((event) => event.phase),
    triggerUserInput: () => inputCallback?.(),
  };
}

describe('BuyAutomationService', () => {
  it('runs the full pipeline on a successful AUTO travel for an auto-buy search', async () => {
    const harness = createHarness();
    try {
      harness.bus.publish(travelSuccess());
      await waitFor(() => harness.phases().includes('moved'));
      expect(harness.phases()).toEqual(['started', 'window-found', 'item-located', 'moved']);
      expect(harness.moveHumanLike).toHaveBeenCalledOnce();
    } finally {
      harness.service.onApplicationShutdown();
    }
  });

  it('also fires on a successful MANUAL travel — Buy is independent of auto-travel (D-19)', async () => {
    const harness = createHarness();
    try {
      harness.bus.publish(travelSuccess({ source: 'manual' }));
      await waitFor(() => harness.phases().includes('moved'));
      expect(harness.moveHumanLike).toHaveBeenCalledOnce();
    } finally {
      harness.service.onApplicationShutdown();
    }
  });

  it.each([
    ['phase not success', travelSuccess({ phase: 'started' })],
    ['null searchId', travelSuccess({ searchId: null })],
  ])('ignores travel events (%s)', async (_label, event) => {
    const harness = createHarness();
    try {
      harness.bus.publish(event);
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(harness.buyEvents).toHaveLength(0);
    } finally {
      harness.service.onApplicationShutdown();
    }
  });

  it('manual buy (requestManualBuy) fires once even when autoBuy is off, then is consumed (#2)', async () => {
    const harness = createHarness({ autoBuy: false });
    try {
      harness.service.requestManualBuy('l1'); // operator clicked Buy on listing l1
      harness.bus.publish(travelSuccess({ source: 'manual' }));
      await waitFor(() => harness.phases().includes('moved'));
      expect(harness.moveHumanLike).toHaveBeenCalledOnce();

      // One-shot: a second travel success for the same listing does NOT re-fire
      // (autoBuy is off and the manual intent was consumed on the first success).
      harness.moveHumanLike.mockClear();
      harness.bus.publish(travelSuccess({ source: 'manual' }));
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(harness.moveHumanLike).not.toHaveBeenCalled();
    } finally {
      harness.service.onApplicationShutdown();
    }
  });

  it('does nothing when autoBuy is off or control is not granted', async () => {
    for (const options of [{ autoBuy: false }, { canControl: false }]) {
      const harness = createHarness(options);
      try {
        harness.bus.publish(travelSuccess());
        await new Promise((resolve) => setTimeout(resolve, 40));
        expect(harness.buyEvents).toHaveLength(0);
      } finally {
        harness.service.onApplicationShutdown();
      }
    }
  });

  it('emits failed(permission revoked) when the gate asserts false at run time', async () => {
    const harness = createHarness({ canControl: true, allowAssert: false });
    try {
      harness.bus.publish(travelSuccess());
      await waitFor(() => harness.phases().includes('failed'));
      expect(harness.buyEvents.find((event) => event.phase === 'failed')?.detail).toBe(
        'permission revoked',
      );
      expect(harness.phases()).not.toContain('started');
    } finally {
      harness.service.onApplicationShutdown();
    }
  });

  it('emits failed(focus-failed) when focus does not land', async () => {
    const harness = createHarness({ focused: false });
    try {
      harness.bus.publish(travelSuccess());
      await waitFor(() => harness.phases().includes('failed'));
      expect(harness.buyEvents.find((event) => event.phase === 'failed')?.detail).toBe(
        'focus-failed',
      );
    } finally {
      harness.service.onApplicationShutdown();
    }
  });

  it('emits failed(trade-window-not-found) when detection times out', async () => {
    const harness = createHarness({ region: null });
    try {
      harness.bus.publish(travelSuccess());
      await waitFor(() => harness.phases().includes('failed'));
      expect(harness.buyEvents.find((event) => event.phase === 'failed')?.detail).toBe(
        'trade-window-not-found',
      );
    } finally {
      harness.service.onApplicationShutdown();
    }
  });

  it('resets the single-flight lock when a port call hangs past the run deadline (REL-2/3)', async () => {
    const harness = createHarness({ captureHangs: true });
    try {
      harness.bus.publish(travelSuccess());
      await waitFor(() => harness.phases().includes('failed'), 4000);
      expect(harness.buyEvents.find((event) => event.phase === 'failed')?.detail).toBe('timeout');
      // Lock reset → a second trigger runs again (proves no permanent wedge).
      harness.bus.publish(travelSuccess());
      await waitFor(
        () => harness.phases().filter((phase) => phase === 'started').length >= 2,
        4000,
      );
    } finally {
      harness.service.onApplicationShutdown();
    }
  });

  it('aborts the move when the user moves the mouse (never reaches moved)', async () => {
    let abortSeen = false;
    const harness = createHarness({
      moveImpl: (_to, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              abortSeen = true;
              reject(new Error('aborted'));
            },
            { once: true },
          );
        }),
    });
    try {
      harness.bus.publish(travelSuccess());
      await waitFor(() => harness.phases().includes('item-located'));
      harness.triggerUserInput();
      await waitFor(() => harness.phases().includes('aborted'));
      expect(abortSeen).toBe(true);
      expect(harness.phases()).not.toContain('moved');
    } finally {
      harness.service.onApplicationShutdown();
    }
  });
});
