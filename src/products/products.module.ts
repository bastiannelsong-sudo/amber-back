import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { Product } from './entities/product.entity'
import { PlatformsModule } from './platforms/platforms.module';
import { CategoriesModule } from './categories/categories.module';
import { Category } from './entities/category.entity';
import { Platform } from './entities/platform.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Product,Category,Platform]),
    CategoriesModule,
    PlatformsModule],
  controllers: [ProductsController],
  providers: [ProductsService],
})
export class ProductsModule {}
