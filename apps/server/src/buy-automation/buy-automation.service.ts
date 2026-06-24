import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { BuyAutomationEvent, DomainEvent } from '@poe-sniper/shared';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { errorMessage } from '../util/error-message.js';
import { RealtimeBus } from '../events/realtime-bus.js';
import {
  CAPTURE_SOURCE,
  INPUT_CONTROLLER,
  TRADE_VISION,
  USER_INPUT_WATCHER,
} from '../platform/platform.tokens.js';
import type {
  CaptureSource,
  InputController,
  Point,
  TradeVision,
  UserInputWatcher,
  WindowRegion,
} from '../platform/ports.js';
import { PermissionDeniedError } from '../permissions/permission-denied.error.js';
import { PermissionGateService } from '../permissions/permission-gate.service.js';
import { SearchManager } from '../search/search-manager.js';

type BuyPhase = BuyAutomationEvent['phase'];

/** Bound on pending one-shot manual-buy intents (each is consumed on the
 *  matching travel success; this only caps listings that never travel). */
const MANUAL_BUY_INTENT_CAP = 50;

/** Focus confirm: poll the frontmost-pid focus check up to this many times
 *  (BUY_FOCUS_VERIFY_MS apart) — covers Wine/fullscreen Space-switch lag. */
const FOCUS_CONFIRM_ATTEMPTS = 8;

/** Abortable delay — rejects if the signal fires first (so awaits unwind promptly). */
function delay(ms: number, signal: AbortSignal): Promise<void> {
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
 * Races a port-call promise against the abort signal so a HUNG desktop call
 * (osascript / getSources cannot be cancelled natively) still rejects when the
 * run-level deadline or user-input fires — guaranteeing the pipeline unwinds to
 * `finally` and the single-flight lock resets (the original promise may dangle).
 */
function untilAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('aborted'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new Error('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Buy automation orchestrator (Phase 2, Electron-only). Subscribes to the
 * RealtimeBus and, on a SUCCESSFUL travel (auto OR manual — independent of the
 * auto-travel toggle, D-19) for an auto-buy search, runs the pipeline:
 * focus + verify → capture loop until the trade window is detected →
 * locate the item → verify-then-act → human-like cursor MOVE (NO click,
 * decision #8). It touches only the game window (never the trade API) and never
 * blocks the sequential travel queue (it fires async, off the bus).
 *
 * Safety: the macOS `control` gate is re-checked live before acting; any real
 * user input aborts the in-flight move; a hard wall-clock deadline guarantees
 * the run can never wedge the single-flight lock; and the desktop adapters
 * re-check the gate at the resource boundary (decision #3).
 */
@Injectable()
export class BuyAutomationService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(BuyAutomationService.name);
  private unsubscribe: (() => void) | null = null;
  /** One buy at a time — a second trigger while a buy runs is ignored. */
  private running = false;
  /** Listing ids the operator clicked "Buy" on — buy on their next travel
   *  success even if the search's autoBuy is off. One-shot (consumed on use). */
  private readonly forceBuyListingIds = new Set<string>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(RealtimeBus) private readonly realtimeBus: RealtimeBus,
    @Inject(SearchManager) private readonly searchManager: SearchManager,
    @Inject(PermissionGateService) private readonly gate: PermissionGateService,
    @Inject(CAPTURE_SOURCE) private readonly capture: CaptureSource,
    @Inject(TRADE_VISION) private readonly vision: TradeVision,
    @Inject(INPUT_CONTROLLER) private readonly input: InputController,
    @Inject(USER_INPUT_WATCHER) private readonly userInput: UserInputWatcher,
  ) {}

  onApplicationBootstrap(): void {
    this.unsubscribe = this.realtimeBus.subscribe((event) => this.maybeBuy(event));
  }

  onApplicationShutdown(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /**
   * Records a one-shot manual-buy intent (the live-hits Buy button): the buy
   * pipeline will run on this listing's next travel success even when the
   * search's autoBuy toggle is off. The endpoint enqueues the travel separately.
   */
  requestManualBuy(listingId: string): void {
    this.forceBuyListingIds.add(listingId);
    while (this.forceBuyListingIds.size > MANUAL_BUY_INTENT_CAP) {
      const oldest = this.forceBuyListingIds.values().next().value;
      if (oldest === undefined) break;
      this.forceBuyListingIds.delete(oldest);
    }
  }

  private maybeBuy(event: DomainEvent): void {
    if (event.type !== 'travel') return;
    // Fires on ANY travel success — auto OR manual (D-19): Buy is independent of
    // the auto-travel toggle, but still acts only once the character has arrived
    // at the seller (a travel success), so there is no capture/teleport race.
    if (event.phase !== 'success') return;
    if (event.searchId === null) return;
    // Buy if the search opted into autoBuy, OR the operator clicked Buy on this
    // listing (a one-shot manual intent — consume it). Manual buy fires even with
    // autoBuy off; both still require the live control gate below.
    const forced = event.listingId !== null && this.forceBuyListingIds.delete(event.listingId);
    if (!forced && !this.searchManager.isAutoBuyEnabled(event.searchId)) return;
    // Optimization: skip when the gate is closed. The adapters re-check at the
    // resource boundary, so this is not the sole guard (decision #3).
    if (!this.gate.canControl()) return;
    // Fire async, OFF the bus — must never block the sequential travel queue.
    void this.run(event.searchId, event.listingId, event.itemName);
  }

  private async run(
    searchId: string,
    listingId: string | null,
    itemName: string | null,
  ): Promise<void> {
    if (this.running) {
      this.logger.debug('buy skipped — another buy is already running');
      return;
    }
    this.running = true;
    const controller = new AbortController();
    // Hard wall-clock deadline over the WHOLE pipeline. With `untilAbort` on
    // every port await, a hung osascript/getSources can never strand the run —
    // the lock always resets (REL-2/3). `timedOut` distinguishes it from a
    // user-input abort for the emitted phase.
    let timedOut = false;
    const deadline = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.config.BUY_RUN_TIMEOUT_MS);
    let stopWatching: (() => void) | null = null;
    try {
      // Live re-check: a revocation since toggle-on aborts before any action.
      try {
        this.gate.assert('control');
      } catch (error) {
        if (error instanceof PermissionDeniedError) {
          this.emit('failed', searchId, listingId, itemName, 'permission revoked');
          return;
        }
        throw error;
      }

      stopWatching = this.userInput.onRealInput(() => controller.abort());
      this.emit('started', searchId, listingId, itemName, null);

      // Focus, then CONFIRM it actually took — Wine `activate` can silently
      // no-op, and bringing a (fullscreen) window forward can lag a Space switch,
      // so poll the frontmost-pid check briefly rather than checking once.
      await untilAbort(this.capture.focusGameWindow(), controller.signal);
      if (!(await this.confirmFocus(controller.signal))) {
        this.emit('failed', searchId, listingId, itemName, 'focus-failed');
        return;
      }
      // Park the cursor in the CENTRE of the game window — it may have been on
      // another monitor or outside the window, and the move eases from wherever
      // the cursor currently sits, so we anchor it inside the game first.
      const center = await untilAbort(this.capture.windowCenter(), controller.signal);
      if (center) await this.input.moveHumanLike(center, controller.signal);

      // Capture loop until the trade window is detected (or give-up / abort).
      const region = await this.detectTradeWindow(controller.signal);
      if (controller.signal.aborted) {
        this.emitAbortOutcome(timedOut, searchId, listingId, itemName);
        return;
      }
      if (!region) {
        this.emit('failed', searchId, listingId, itemName, 'trade-window-not-found');
        return;
      }
      this.emit('window-found', searchId, listingId, itemName, null);

      // Locate, then VERIFY-THEN-ACT on a fresh frame before moving.
      if (!(await this.locate(region, itemName, controller.signal))) {
        this.emit('failed', searchId, listingId, itemName, 'item-not-located');
        return;
      }
      this.emit('item-located', searchId, listingId, itemName, null);
      const confirmed = await this.locate(region, itemName, controller.signal);
      if (!confirmed) {
        this.emit('failed', searchId, listingId, itemName, 'item-vanished-before-move');
        return;
      }

      // Map the violet-cluster point (frame pixels) to a real screen point, then
      // human-like MOVE — no click (decision #8). Aborts on real user input.
      const target = this.capture.frameToScreen(confirmed);
      await this.input.moveHumanLike(target, controller.signal);
      if (controller.signal.aborted) {
        this.emitAbortOutcome(timedOut, searchId, listingId, itemName);
        return;
      }
      this.emit('moved', searchId, listingId, itemName, null);
    } catch (error) {
      if (controller.signal.aborted) {
        this.emitAbortOutcome(timedOut, searchId, listingId, itemName);
      } else {
        this.emit('failed', searchId, listingId, itemName, errorMessage(error));
      }
    } finally {
      clearTimeout(deadline);
      stopWatching?.();
      controller.abort();
      this.running = false;
    }
  }

  /** Poll the focus check until it confirms or the attempts run out (aborts on signal). */
  private async confirmFocus(signal: AbortSignal): Promise<boolean> {
    for (let attempt = 0; attempt < FOCUS_CONFIRM_ATTEMPTS; attempt += 1) {
      if (await untilAbort(this.capture.isGameWindowFocused(), signal)) return true;
      try {
        await delay(this.config.BUY_FOCUS_VERIFY_MS, signal);
      } catch {
        return false; // run-level abort (user / deadline)
      }
    }
    return false;
  }

  private async detectTradeWindow(signal: AbortSignal): Promise<WindowRegion | null> {
    // Give-up timer for "no trade window yet" — a NORMAL outcome (clean null),
    // distinct from the run-level abort that `untilAbort` turns into a throw.
    let timedOut = false;
    const giveUp = setTimeout(() => {
      timedOut = true;
    }, this.config.BUY_CAPTURE_TIMEOUT_MS);
    try {
      while (!signal.aborted && !timedOut) {
        const frame = await untilAbort(this.capture.capture(), signal);
        const region = await this.vision.detectTradeWindow(frame);
        if (region) return region;
        try {
          await delay(this.config.BUY_CAPTURE_POLL_MS, signal);
        } catch {
          break; // run-level abort (user / deadline)
        }
      }
      return null;
    } finally {
      clearTimeout(giveUp);
    }
  }

  private async locate(
    region: WindowRegion,
    itemName: string | null,
    signal: AbortSignal,
  ): Promise<Point | null> {
    const frame = await untilAbort(this.capture.capture(), signal);
    return this.vision.locateItem(frame, region, itemName);
  }

  private emitAbortOutcome(
    timedOut: boolean,
    searchId: string | null,
    listingId: string | null,
    itemName: string | null,
  ): void {
    if (timedOut) this.emit('failed', searchId, listingId, itemName, 'timeout');
    else this.emit('aborted', searchId, listingId, itemName, 'user input');
  }

  private emit(
    phase: BuyPhase,
    searchId: string | null,
    listingId: string | null,
    itemName: string | null,
    detail: string | null,
  ): void {
    if (phase === 'failed') {
      this.logger.warn(`buy ${listingId ?? '?'} failed: ${detail ?? 'unknown'}`);
    }
    this.realtimeBus.publish({
      type: 'buy',
      phase,
      searchId,
      listingId,
      itemName,
      detail,
      at: new Date().toISOString(),
    });
  }
}
