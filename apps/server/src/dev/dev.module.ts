import { Module } from '@nestjs/common';
import { DevController } from './dev.controller.js';

/**
 * DEV-ONLY module — imported by AppModule only when APP_ENV==='development'.
 * Hosts the permission-status push endpoint that gives `pnpm dev` the same
 * capability gate as the packaged app (see PushedPermissionProbe).
 */
@Module({ controllers: [DevController] })
export class DevModule {}
