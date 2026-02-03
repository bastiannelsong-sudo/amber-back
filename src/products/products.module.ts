import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { Product } from './entities/product.entity';
import { ProductHistory } from './entities/product-history.entity';
import { SecondarySku } from './entities/secondary-sku.entity';
import { PlatformsModule } from './platforms/platforms.module';
import { CategoriesModule } from './categories/categories.module';
import { Category } from './entities/category.entity';
import { Platform } from './entities/platform.entity';
import { ProductHistoryService } from './services/product-history.service';
import { TaxService } from './services/tax.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Product, Category, Platform, ProductHistory, SecondarySku]),
    CategoriesModule,
    PlatformsModule,
  ],
  controllers: [ProductsController],
  providers: [ProductsService, ProductHistoryService, TaxService],
  exports: [TaxService],
})
export class ProductsModule {}
