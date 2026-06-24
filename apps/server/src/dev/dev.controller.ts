import { BadRequestException, Body, Controller, Inject, Post } from '@nestjs/common';
import { z } from 'zod';
import { CAPTURE_SOURCE, PERMISSION_PROBE, TRADE_VISION } from '../platform/platform.tokens.js';
import type { CaptureSource, PermissionProbe, RawFrame, TradeVision } from '../platform/ports.js';
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
  @Post('capture-probe')
  async captureProbe(): Promise<unknown> {
    const focusIssued = await this.capture.focusGameWindow();
    const focusConfirmed = await this.capture.isGameWindowFocused();
    const frames: Array<{ width: number; height: number }> = [];
    let frame: RawFrame | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      frame = await this.capture.capture();
      frames.push({ width: frame.width, height: frame.height });
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    const region = frame ? await this.vision.detectTradeWindow(frame) : null;
    const point = frame && region ? await this.vision.locateItem(frame, region, null) : null;
    const screen = point ? this.capture.frameToScreen(point) : null;
    return { focusIssued, focusConfirmed, frames, region, point, screen };
  }
}
