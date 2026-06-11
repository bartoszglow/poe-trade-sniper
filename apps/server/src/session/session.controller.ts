import { BadRequestException, Body, Controller, Delete, Get, Inject, Post } from '@nestjs/common';
import { z } from 'zod';
import type { SessionPublicStatus } from '@poe-sniper/shared';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { SessionService } from './session.service.js';

const setCookiesSchema = z.object({
  /** Cookie name → value, pasted by the user from their own browser. */
  cookies: z.record(z.string().min(1), z.string().min(1)),
  /**
   * Should match the browser the cookies came from when cf_clearance is
   * included (Cloudflare binds clearance to the UA). Optional otherwise.
   */
  userAgent: z.string().min(1).optional(),
});

@Controller('session')
export class SessionController {
  constructor(
    @Inject(SessionService) private readonly sessionService: SessionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('status')
  status(): SessionPublicStatus {
    return this.sessionService.publicStatus();
  }

  @Post('cookies')
  setCookies(@Body() body: unknown): SessionPublicStatus {
    const parsed = setCookiesSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((issue) => issue.message).join('; '));
    }
    try {
      return this.sessionService.setFromCookies(
        parsed.data.cookies,
        parsed.data.userAgent ?? this.config.FALLBACK_USER_AGENT,
      );
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'invalid cookies');
    }
  }

  @Delete()
  clear(): { cleared: true } {
    this.sessionService.clear();
    return { cleared: true };
  }
}
