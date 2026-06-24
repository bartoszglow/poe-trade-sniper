import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { BuyAutomationEvent, DomainEvent } from '@poe-sniper/shared';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
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
 * Buy automation orchestrator (Phase 2, Electron-only). Subscribes to the
 * RealtimeBus and, on a SUCCESSFUL AUTO travel for an auto-buy search, runs the
 * pipeline: focus + verify → capture loop until the trade window is detected →
 * locate the item → verify-then-act → human-like cursor MOVE (NO click,
 * decision #8). It touches only the game window (never the trade API) and never
 * blocks the sequential travel queue (it fires async, off the bus).
 *
 * Safety: the macOS `control` gate is re-checked live before acting; any real
 * user input aborts the in-flight move; and the desktop adapters re-check the
 * gate at the resource boundary, so gating holds even if this pre-check is
 * bypassed (decision #3).
 */
@Injectable()
export class BuyAutomationService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(BuyAutomationService.name);
  private unsubscribe: (() => void) | null = null;
  /** One buy at a time — a second trigger while a buy runs is ignored. */
  private running = false;

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

  private maybeBuy(event: DomainEvent): void {
    if (event.type !== 'travel') return;
    if (event.phase !== 'success' || event.source !== 'auto') return;
    if (event.searchId === null) return;
    if (!this.searchManager.isAutoBuyEnabled(event.searchId)) return;
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

      // Focus + VERIFY — Wine `activate` can silently no-op.
      await this.capture.focusGameWindow();
      await delay(this.config.BUY_FOCUS_VERIFY_MS, controller.signal);
      if (!(await this.capture.isGameWindowFocused())) {
        this.emit('failed', searchId, listingId, itemName, 'focus-failed');
        return;
      }

      // Capture loop until the trade window is detected (or timeout / abort).
      const region = await this.detectTradeWindow(controller.signal);
      if (controller.signal.aborted) {
        this.emit('aborted', searchId, listingId, itemName, 'user input');
        return;
      }
      if (!region) {
        this.emit('failed', searchId, listingId, itemName, 'trade-window-not-found');
        return;
      }
      this.emit('window-found', searchId, listingId, itemName, null);

      // Locate, then VERIFY-THEN-ACT on a fresh frame before moving.
      if (!(await this.locate(region, itemName))) {
        this.emit('failed', searchId, listingId, itemName, 'item-not-located');
        return;
      }
      this.emit('item-located', searchId, listingId, itemName, null);
      const confirmed = await this.locate(region, itemName);
      if (!confirmed) {
        this.emit('failed', searchId, listingId, itemName, 'item-vanished-before-move');
        return;
      }

      // Human-like MOVE — no click (decision #8). Aborts on real user input.
      await this.input.moveHumanLike(confirmed, controller.signal);
      if (controller.signal.aborted) {
        this.emit('aborted', searchId, listingId, itemName, 'user input');
        return;
      }
      this.emit('moved', searchId, listingId, itemName, null);
    } catch (error) {
      if (controller.signal.aborted) {
        this.emit('aborted', searchId, listingId, itemName, 'user input');
      } else {
        this.emit('failed', searchId, listingId, itemName, errorMessage(error));
      }
    } finally {
      stopWatching?.();
      controller.abort();
      this.running = false;
    }
  }

  private async detectTradeWindow(signal: AbortSignal): Promise<WindowRegion | null> {
    const combined = AbortSignal.any([
      signal,
      AbortSignal.timeout(this.config.BUY_CAPTURE_TIMEOUT_MS),
    ]);
    while (!combined.aborted) {
      const frame = await this.capture.capture();
      const region = await this.vision.detectTradeWindow(frame);
      if (region) return region;
      try {
        await delay(this.config.BUY_CAPTURE_POLL_MS, combined);
      } catch {
        break; // aborted (user) or timed out
      }
    }
    return null;
  }

  private async locate(region: WindowRegion, itemName: string | null): Promise<Point | null> {
    const frame = await this.capture.capture();
    return this.vision.locateItem(frame, region, itemName);
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
