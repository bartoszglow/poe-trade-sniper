import { BadRequestException, Body, Controller, Inject, Post } from '@nestjs/common';
import { z } from 'zod';
import {
  CAPTURE_SOURCE,
  INPUT_CONTROLLER,
  PERMISSION_PROBE,
  TRADE_VISION,
} from '../platform/platform.tokens.js';
import type {
  CaptureSource,
  InputController,
  PermissionProbe,
  RawFrame,
  TradeVision,
} from '../platform/ports.js';
import { PushedPermissionProbe } from '../platform/pushed-permission-probe.js';

const permissionStateSchema = z.enum([
  'granted',
  'denied',
  'restricted',
  'not-determined',
  'unsupported',
]);
// Mirrors PERMISSION_KINDS — keep in sync if a kind is added (dev-only surface).
const permissionsSchema = z.object({
  screenRecording: permissionStateSchema,
  accessibility: permissionStateSchema,
});

/**
 * DEV-ONLY surface (registered by AppModule only when APP_ENV==='development').
 * The Electron main pushes the real macOS TCC status here so the standalone dev
 * server's capability gate + `/api/status` are real — dev↔prod parity (see
 * `PushedPermissionProbe`). Loopback-guarded by the app-wide HostGuard; the
 * payload is permission states only (no secrets).
 */
@Controller('dev')
export class DevController {
  constructor(
    @Inject(PERMISSION_PROBE) private readonly probe: PermissionProbe,
    @Inject(CAPTURE_SOURCE) private readonly capture: CaptureSource,
    @Inject(TRADE_VISION) private readonly vision: TradeVision,
    @Inject(INPUT_CONTROLLER) private readonly input: InputController,
  ) {}

  @Post('permissions')
  setPermissions(@Body() body: unknown): { ok: true } {
    const parsed = permissionsSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('invalid permissions payload');
    // Only the dev platform's probe is pushable; a no-op/real probe ignores it.
    if (this.probe instanceof PushedPermissionProbe) {
      this.probe.set(parsed.data);
    }
    return { ok: true };
  }

  /**
   * DEV-ONLY: run the capture + vision pipeline ONCE with NO travel and NO cursor
   * move — focus the game, capture a few frames (written as PNGs when
   * BUY_DEBUG_DUMP_DIR is set), then detect the trade window + locate the violet
   * item. Returns the geometry so the capture↔detection can be debugged live
   * without teleporting the character or hitting GGG.
   */
  /** DEV: bare cursor move — NO focus, NO capture — to isolate nut.js in the
   *  dev:desktop process from the focus/capture sequence. */
  @Post('move-test')
  async moveTest(): Promise<unknown> {
    await this.input.placeCursor({ x: 400, y: 300 });
    await new Promise((resolve) => setTimeout(resolve, 250));
    await this.input.placeCursor({ x: 1000, y: 700 });
    return { ok: true };
  }

  @Post('capture-probe')
  async captureProbe(): Promise<unknown> {
    const now = () => Date.now();
    let mark = now();
    const focusIssued = await this.capture.focusGameWindow();
    const focusMs = now() - mark;
    mark = now();
    const focusConfirmed = await this.capture.isGameWindowFocused();
    const confirmMs = now() - mark;
    const captureMs: number[] = [];
    let frame: RawFrame | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      mark = now();
      frame = await this.capture.capture();
      captureMs.push(now() - mark);
    }
    mark = now();
    const analysis = frame ? this.vision.analyze(frame) : { shopOpen: false, item: null };
    const analyzeMs = now() - mark;
    const screen = analysis.item ? this.capture.frameToScreen(analysis.item) : null;
    mark = now();
    if (screen) await this.input.placeCursor(screen); // DEV: actually move, to test the full chain
    const placeMs = now() - mark;
    return {
      focusIssued,
      focusConfirmed,
      focusMs,
      confirmMs,
      captureMs,
      analyzeMs,
      placeMs,
      shopOpen: analysis.shopOpen,
      item: analysis.item,
      screen,
    };
  }

  /** DEV: focus + capture + locate the golden "Leave Hideout" button (NO ESC, NO
   *  click) — to validate that detection before wiring it into the buy return. */
  @Post('leave-hideout-probe')
  async leaveHideoutProbe(): Promise<unknown> {
    await this.capture.focusGameWindow();
    const frame = await this.capture.capture();
    const button = this.vision.locateLeaveHideout(frame);
    const screen = button ? this.capture.frameToScreen(button) : null;
    return { frame: { w: frame.width, h: frame.height }, button, screen };
  }
}
