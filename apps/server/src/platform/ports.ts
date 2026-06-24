import type { PermissionKind, PermissionState } from '@poe-sniper/shared';

/**
 * Reads / requests OS permission state. Implemented natively only in the desktop
 * shell (Electron `systemPreferences`, macOS); the no-op default reports
 * `'unsupported'` everywhere else.
 */
export interface PermissionProbe {
  /** Live, non-blocking read (cheap enough to poll for revocation). */
  query(kind: PermissionKind): PermissionState;
  /** Trigger the OS prompt or deep-link to the Settings pane. */
  request(kind: PermissionKind): Promise<void>;
  /** Open the System Settings pane for this kind (manage / revoke). */
  openSettingsPane(kind: PermissionKind): void;
}

/** An RGBA pixel frame captured from the game window (row-major, 4 bytes/px). */
export interface RawFrame {
  width: number;
  height: number;
  pixels: Uint8Array;
}

/** A rectangular region within a `RawFrame` (frame-pixel coordinates). */
export interface WindowRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * An abstract target point. The desktop adapters own the ONLY capture↔screen /
 * HiDPI mapping (`toScreenPoint`); the orchestrator passes Points through
 * opaquely (`locateItem` already returns screen-space; `moveHumanLike` consumes it).
 */
export interface Point {
  x: number;
  y: number;
}

/**
 * Captures the game window and manages its focus. The adapter self-checks the
 * `capture` capability and throws `PermissionDeniedError` when Screen Recording
 * is missing — the structural chokepoint (decision #3), not just the orchestrator's
 * pre-check.
 */
export interface CaptureSource {
  capture(): Promise<RawFrame>;
  /** Bring the game window to the foreground; returns whether the call was issued. */
  focusGameWindow(): Promise<boolean>;
  /** Verify focus actually landed (Wine `activate` can silently no-op). */
  isGameWindowFocused(): Promise<boolean>;
  /**
   * The game window's CENTRE in global screen points (multi-monitor aware), so
   * the orchestrator can park the cursor inside the game right after focus —
   * before any capture — instead of assuming it already starts there. `null`
   * when the window can't be located.
   */
  windowCenter(): Promise<Point | null>;
  /**
   * Map a point in the LAST captured frame's pixel space to a global screen
   * point — applying the captured display's origin + the frame→logical scale
   * (HiDPI). This is the one capture↔screen mapping; the orchestrator moves to
   * the result. Identity until the first `capture()`.
   */
  frameToScreen(point: Point): Point;
}

/**
 * Computer-vision over a captured frame: find the trade/merchant window, then
 * the selected item inside it. Pure analysis — no OS permission of its own (it
 * only reads frames the `CaptureSource` produced). `locateItem` returns a
 * screen-space `Point` (the adapter maps frame→screen internally).
 */
export interface TradeVision {
  detectTradeWindow(frame: RawFrame): Promise<WindowRegion | null>;
  locateItem(frame: RawFrame, region: WindowRegion, target: string | null): Promise<Point | null>;
}

/**
 * Human-like cursor control. The adapter self-checks the `control` capability
 * and throws `PermissionDeniedError` when its grant is missing. There is NO
 * `click` by design until the verify-then-act click iteration (decision #8).
 */
export interface InputController {
  /** Move to `to` in small jittered, awaited steps; abort promptly on `signal`. */
  moveHumanLike(to: Point, signal: AbortSignal): Promise<void>;
  /**
   * Place the cursor AT `to` instantly — one absolute `setPosition`, no easing,
   * no read of the current position. The default "instant" buy mode: because it
   * sets the absolute target it can't drift relative to where the cursor started.
   */
  placeCursor(to: Point): Promise<void>;
}

/**
 * Global real-input watcher (uiohook). Fires the callback when the USER moves
 * the mouse / presses a key, so an in-flight automated move aborts and never
 * fights the operator. Returns an unsubscribe fn.
 */
export interface UserInputWatcher {
  onRealInput(callback: () => void): () => void;
}

/**
 * The desktop-platform aggregate the shell injects into the server before
 * `app.listen()`. The no-op default keeps the server cross-platform and testable;
 * the real adapters (Electron `desktopCapturer`, OpenCV-wasm, `nut.js`,
 * `uiohook-napi`) live only in `apps/desktop`.
 */
export interface DesktopPlatform {
  permissionProbe: PermissionProbe;
  captureSource: CaptureSource;
  tradeVision: TradeVision;
  inputController: InputController;
  userInputWatcher: UserInputWatcher;
}
