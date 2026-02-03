import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from '../products/entities/product.entity';
import { ProductHistory } from '../products/entities/product-history.entity';
import { ProductMapping } from '../products/entities/product-mapping.entity';
import { SecondarySku } from '../products/entities/secondary-sku.entity';
import { PendingSale } from '../notification/entities/pending-sale.entity';
import { Platform } from '../products/entities/platform.entity';
import { InventoryService } from '../products/services/inventory.service';
import { ProductMappingService } from '../products/services/product-mapping.service';
import { PendingSalesService } from '../notification/services/pending-sales.service';
import { ProductMappingController } from '../products/controllers/product-mapping.controller';
import { PendingSalesController } from '../notification/controllers/pending-sales.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Product,
      ProductHistory,
      ProductMapping,
      SecondarySku,
      PendingSale,
      Platform,
    ]),
  ],
  controllers: [
    ProductMappingController,
    PendingSalesController,
  ],
  providers: [
    InventoryService,
    ProductMappingService,
    PendingSalesService,
  ],
  exports: [
    InventoryService,
    ProductMappingService,
    PendingSalesService,
  ],
})
export class InventoryModule {}
