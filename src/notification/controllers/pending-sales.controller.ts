import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { PendingSalesService } from '../services/pending-sales.service';
import { ResolvePendingSaleDto } from '../dto/resolve-pending-sale.dto';
import { PendingSaleStatus } from '../entities/pending-sale.entity';

@Controller('pending-sales')
export class PendingSalesController {
  constructor(private readonly pendingSalesService: PendingSalesService) {}

  @Get()
  findAll(
    @Query('status') status?: PendingSaleStatus,
    @Query('platformId') platformId?: number,
  ) {
    return this.pendingSalesService.findAll(status, platformId);
  }

  @Get('count')
  getCount(@Query('status') status?: PendingSaleStatus) {
    return this.pendingSalesService.getCount(status);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.pendingSalesService.findById(id);
  }

  @Post(':id/resolve')
  resolve(
    @Param('id', ParseIntPipe) id: number,
    @Body() resolveDto: ResolvePendingSaleDto,
  ) {
    return this.pendingSalesService.resolve(id, resolveDto);
  }

  @Post(':id/ignore')
  ignore(
    @Param('id', ParseIntPipe) id: number,
    @Body('resolved_by') resolvedBy: string,
  ) {
    return this.pendingSalesService.ignore(id, resolvedBy);
  }

  @Get('platform/:id')
  findByPlatform(@Param('id', ParseIntPipe) id: number) {
    return this.pendingSalesService.findAll(undefined, id);
  }
}
