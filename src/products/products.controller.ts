import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Put,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { TaxService } from './services/tax.service';

@Controller('products')
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly taxService: TaxService,
  ) {}

  @Post()
  create(@Body() createProductDto: CreateProductDto) {
    return this.productsService.createProduct(createProductDto);
  }

  @Get()
  findAll() {
    return this.productsService.findAll();
  }

  @Get('low-stock')
  getLowStock(@Query('threshold') threshold?: number) {
    return this.productsService.getLowStock(
      threshold ? Number(threshold) : 10,
    );
  }

  @Get('tax/config')
  getTaxConfig() {
    return {
      iva_percentage: this.taxService.getIvaPercentage(),
    };
  }

  @Get(':id')
  findOne(@Param('id') id: number) {
    return this.productsService.findOne(id);
  }

  @Get(':id/history')
  getHistory(@Param('id') id: number, @Query('limit') limit?: number) {
    return this.productsService.getHistory(id, limit ? Number(limit) : 50);
  }

  @Put(':id')
  update(@Param('id') id: number, @Body() updateProductDto: UpdateProductDto) {
    // Validar que se incluya la razón del cambio para cambios manuales
    if (!updateProductDto.change_reason) {
      throw new BadRequestException(
        'Debe proporcionar una razón para el cambio (change_reason)',
      );
    }
    return this.productsService.updateProduct(id, updateProductDto);
  }

  @Delete(':id')
  remove(
    @Param('id') id: number,
    @Query('reason') reason: string,
    @Query('changed_by') changed_by: string,
  ) {
    // Validar que se incluya la razón de la eliminación
    if (!reason) {
      throw new BadRequestException(
        'Debe proporcionar una razón para eliminar el producto',
      );
    }
    if (!changed_by) {
      throw new BadRequestException(
        'Debe proporcionar quién está eliminando el producto',
      );
    }
    return this.productsService.removeProduct(id, reason, changed_by);
  }

  @Post(':id/adjust-stock')
  adjustStock(
    @Param('id') id: number,
    @Body() adjustStockDto: AdjustStockDto,
  ) {
    return this.productsService.adjustStock(id, adjustStockDto);
  }

  @Get(':id/cost-with-iva')
  async getCostWithIva(@Param('id') id: number) {
    const product = await this.productsService.findOne(id);
    if (!product) {
      throw new BadRequestException('Producto no encontrado');
    }
    const cost = product.cost || 0;
    return {
      product_id: product.product_id,
      name: product.name,
      cost_net: cost,
      iva_percentage: this.taxService.getIvaPercentage(),
      iva_amount: this.taxService.calculateIva(cost),
      cost_with_iva: this.taxService.addIva(cost),
    };
  }
}
