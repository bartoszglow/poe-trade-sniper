import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ExportService } from './export.service.js';

/** GET /api/export/{searches|hits|activity} — file-download attachments. */
@Controller('export')
export class ExportController {
  constructor(@Inject(ExportService) private readonly exportService: ExportService) {}

  @Get('searches')
  searches(@Res() res: Response): void {
    const envelope = this.exportService.exportSearchesEnvelope();
    this.attach(
      res,
      'application/json; charset=utf-8',
      'poe-sniper-searches.json',
      JSON.stringify(envelope, null, 2),
    );
  }

  @Get('hits')
  hits(@Res() res: Response): void {
    this.attach(
      res,
      'text/csv; charset=utf-8',
      'poe-sniper-hits.csv',
      this.exportService.exportHitsCsv(),
    );
  }

  @Get('activity')
  activity(@Res() res: Response): void {
    this.attach(
      res,
      'text/csv; charset=utf-8',
      'poe-sniper-activity.csv',
      this.exportService.exportActivityCsv(),
    );
  }

  private attach(res: Response, contentType: string, filename: string, body: string): void {
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(body);
  }
}
