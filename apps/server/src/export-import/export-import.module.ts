import { Module } from '@nestjs/common';
import { SearchModule } from '../search/search.module.js';
import { ExportController } from './export.controller.js';
import { ExportService } from './export.service.js';
import { ImportController } from './import.controller.js';
import { ImportService } from './import.service.js';

/**
 * Operator data export/import: searches (JSON round-trip) + hits/activity (CSV export).
 * DATABASE is global; SearchManager comes from SearchModule. Reads only credential-free
 * tables — the encrypted session in app_state is never exported (hard rule #3).
 */
@Module({
  imports: [SearchModule],
  controllers: [ExportController, ImportController],
  providers: [ExportService, ImportService],
})
export class ExportImportModule {}
