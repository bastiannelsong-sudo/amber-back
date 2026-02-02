import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from './entities/order.entity';
import { Payment } from './entities/payment.entity';
import { OrderItem } from './entities/order-item.entity';
import { User } from './entities/user.entity';
import { MonthlyFlexCost } from './entities/monthly-flex-cost.entity';
import { FaztConfiguration } from './entities/fazt-configuration.entity';
import { MonthlyConfiguration } from './entities/monthly-configuration.entity';
import { ProductAudit } from '../notification/entities/product-audit.entity';
import { PendingSale } from '../notification/entities/pending-sale.entity';
import { InventoryModule } from '../inventory/inventory.module';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';
import { MonthlyFlexCostController } from './monthly-flex-cost.controller';
import { MonthlyFlexCostService } from './monthly-flex-cost.service';
import { FaztConfigurationController } from './fazt-configuration.controller';
import { FaztConfigurationService } from './fazt-configuration.service';
import { MonthlyConfigurationController } from './monthly-configuration.controller';
import { MonthlyConfigurationService } from './monthly-configuration.service';
import { MercadoLibreModule } from '../mercadolibre/mercadolibre.module';
import { ProductsModule } from '../products/products.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Order,
      Payment,
      OrderItem,
      User,
      MonthlyFlexCost,
      FaztConfiguration,
      MonthlyConfiguration,
      ProductAudit,
      PendingSale,
    ]),
    MercadoLibreModule,
    ProductsModule,
    InventoryModule,
  ],
  controllers: [
    OrderController,
    MonthlyFlexCostController,
    FaztConfigurationController,
    MonthlyConfigurationController,
  ],
  providers: [
    OrderService,
    MonthlyFlexCostService,
    FaztConfigurationService,
    MonthlyConfigurationService,
  ],
  exports: [
    OrderService,
    MonthlyFlexCostService,
    FaztConfigurationService,
    MonthlyConfigurationService,
  ],
})
export class OrderModule {}
