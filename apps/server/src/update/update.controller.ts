import { Controller, Get, Inject } from '@nestjs/common';
import type { UpdateStatus } from '@poe-sniper/shared';
import { UpdateService } from './update.service.js';

@Controller('update')
export class UpdateController {
  constructor(@Inject(UpdateService) private readonly updateService: UpdateService) {}

  @Get()
  status(): Promise<UpdateStatus> {
    return this.updateService.check();
  }
}
