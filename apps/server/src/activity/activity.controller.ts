import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { z } from 'zod';
import type { ActivityRecord } from '@poe-sniper/shared';
import { ActivityService } from './activity.service.js';

const activityQuerySchema = z
  .object({
    search: z.string().optional(),
    outcome: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

/** Read-only operator activity timeline (paginated + filterable), mirrors /api/hits. */
@Controller('activity')
export class ActivityController {
  constructor(@Inject(ActivityService) private readonly activityService: ActivityService) {}

  @Get()
  list(@Query() query: Record<string, string>): ActivityRecord[] {
    const parsed = activityQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('invalid activity query');
    const { search, outcome, from, to, limit, offset } = parsed.data;
    return this.activityService.listActivity({
      search: search ?? null,
      outcome: outcome ?? null,
      from: from ?? null,
      to: to ?? null,
      limit,
      offset,
    });
  }
}
