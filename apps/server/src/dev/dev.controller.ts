import { BadRequestException, Body, Controller, Inject, Post } from '@nestjs/common';
import { z } from 'zod';
import { PERMISSION_PROBE } from '../platform/platform.tokens.js';
import type { PermissionProbe } from '../platform/ports.js';
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
  constructor(@Inject(PERMISSION_PROBE) private readonly probe: PermissionProbe) {}

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
}
