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

  @Get()
  findAll(@Query('platformId', new ParseIntPipe({ optional: true })) platformId?: number) {
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
