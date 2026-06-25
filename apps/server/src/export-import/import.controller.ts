import { Body, Controller, Inject, Post, Query } from '@nestjs/common';
import type { ImportResult } from '@poe-sniper/shared';
import { ImportService } from './import.service.js';

/** POST /api/import/searches?mode=skip|replace — JSON body (matches the codebase norm). */
@Controller('import')
export class ImportController {
  constructor(@Inject(ImportService) private readonly importService: ImportService) {}

  @Post('searches')
  searches(@Body() body: unknown, @Query('mode') mode?: string): ImportResult {
    return this.importService.importSearches(body, mode === 'replace' ? 'replace' : 'skip');
  }
}
