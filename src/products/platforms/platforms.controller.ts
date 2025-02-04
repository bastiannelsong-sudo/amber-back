import { Controller, Get } from '@nestjs/common';
import { PlatformsService } from './platforms.service';
import { Platform } from '../entities/platform.entity';

@Controller('platforms')
export class PlatformsController {
  constructor(private readonly platformsService: PlatformsService) {}

  @Get()
  findAll(): Promise<Platform[]> {
    return this.platformsService.findAll();
  }
}
