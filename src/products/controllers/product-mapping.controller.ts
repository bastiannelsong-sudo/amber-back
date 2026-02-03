import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { ProductMappingService } from '../services/product-mapping.service';
import { CreateProductMappingDto } from '../dto/create-product-mapping.dto';

@Controller('product-mappings')
export class ProductMappingController {
  constructor(private readonly mappingService: ProductMappingService) {}

  @Post()
  create(@Body() createDto: CreateProductMappingDto) {
    return this.mappingService.create(createDto);
  }

  @Post('bulk')
  async createBulk(@Body() dtos: CreateProductMappingDto[]) {
    const results = [];
    for (const dto of dtos) {
      const mapping = await this.mappingService.create(dto);
      results.push(mapping);
    }
    return results;
  }

  @Get()
  findAll(@Query('platformId') platformId?: number) {
    return this.mappingService.findAll(platformId);
  }

  @Get('platform/:id')
  findByPlatform(@Param('id', ParseIntPipe) id: number) {
    return this.mappingService.findAll(id);
  }

  @Get('product/:id')
  findByProduct(@Param('id', ParseIntPipe) id: number) {
    return this.mappingService.findByProductId(id);
  }

  @Patch(':id/toggle-active')
  toggleActive(@Param('id', ParseIntPipe) id: number) {
    return this.mappingService.toggleActive(id);
  }

  @Delete(':id')
  delete(@Param('id', ParseIntPipe) id: number) {
    return this.mappingService.delete(id);
  }
}
