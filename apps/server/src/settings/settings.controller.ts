import { BadRequestException, Body, Controller, Get, Inject, Patch } from '@nestjs/common';
import { z } from 'zod';
import type { AppSettings } from '@poe-sniper/shared';
import { AppSettingsService } from './app-settings.service.js';

const settingsPatchSchema = z
  .object({
    cursorMode: z.enum(['instant', 'smooth']).optional(),
    priceCheckHotkey: z.string().min(1).max(120).optional(),
    priceCheckSinks: z.array(z.enum(['panel', 'overlay'])).optional(),
  })
  .strict();

/** Read + update user settings. Loopback-guarded app-wide; no secrets here. */
@Controller('settings')
export class SettingsController {
  constructor(@Inject(AppSettingsService) private readonly settings: AppSettingsService) {}

  @Get()
  get(): AppSettings {
    return this.settings.get();
  }

  @Patch()
  patch(@Body() body: unknown): AppSettings {
    const parsed = settingsPatchSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('invalid settings payload');
    return this.settings.update(parsed.data);
  }
}
