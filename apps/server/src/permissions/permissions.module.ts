import { Module } from '@nestjs/common';
import { PermissionsService } from './permissions.service.js';
import { PermissionGateService } from './permission-gate.service.js';

/**
 * Permission status + the capability gate. Depends on `PERMISSION_PROBE` from
 * the global `PlatformModule`, so it needs no per-platform import.
 */
@Module({
  providers: [PermissionsService, PermissionGateService],
  exports: [PermissionsService, PermissionGateService],
})
export class PermissionsModule {}
