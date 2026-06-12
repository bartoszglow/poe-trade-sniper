import { Controller, Get, Inject } from '@nestjs/common';
import type { NetworkLogEntry } from '@poe-sniper/shared';
import { NetworkLog } from './network-log.service.js';

interface NetworkSnapshot {
  entries: NetworkLogEntry[];
  /** Path of the shareable on-disk log (for the dev view + bug reports). */
  logFilePath: string;
}

/** Read model for the dev "Network" view; live updates arrive over SSE. */
@Controller('network')
export class NetworkController {
  constructor(@Inject(NetworkLog) private readonly networkLog: NetworkLog) {}

  @Get()
  snapshot(): NetworkSnapshot {
    return { entries: this.networkLog.recent(), logFilePath: this.networkLog.logFilePath() };
  }
}
