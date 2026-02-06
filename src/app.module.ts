import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { User } from './orders/entities/user.entity';
import { Order } from './orders/entities/order.entity';
import { OrderItem } from './orders/entities/order-item.entity';
import { Payment } from './orders/entities/payment.entity';
import { OrderModule } from './orders/order.module';
import { AuthModule } from './auth/auth.module';
import { NotificationModule } from './notification/notification.module';
import { Notification } from './notification/entities/notification.entity';
import { Session } from './auth/entities/session.entity';
import { HttpModule } from '@nestjs/axios';
import { ProductsModule } from './products/products.module';
import { Product } from './products/entities/product.entity';
import { Platform } from './products/entities/platform.entity';
import { SecondarySku } from './products/entities/secondary-sku.entity';
import { Category } from './products/entities/category.entity';
import { ProductAudit } from './notification/entities/product-audit.entity';
import { MercadoLibreModule } from './mercadolibre/mercadolibre.module';
import { StockValidationSnapshot } from './mercadolibre/entities/stock-validation-snapshot.entity';
import { ProductHistory } from './products/entities/product-history.entity';
import { ProductMapping } from './products/entities/product-mapping.entity';
import { PendingSale } from './notification/entities/pending-sale.entity';
import { InventoryModule } from './inventory/inventory.module';
import { MonthlyFlexCost } from './orders/entities/monthly-flex-cost.entity';
import { FaztConfiguration } from './orders/entities/fazt-configuration.entity';
import { MonthlyConfiguration } from './orders/entities/monthly-configuration.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    EventEmitterModule.forRoot(),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST'),
        port: configService.get<number>('DB_PORT'),
        username: configService.get<string>('DB_USERNAME'),
        password: configService.get<string>('DB_PASSWORD'),
        database: configService.get<string>('DB_DATABASE'),
        entities: [User, Order, OrderItem, Payment, Notification, Session, Product, Platform, SecondarySku, Category, ProductAudit, ProductHistory, ProductMapping, PendingSale, MonthlyFlexCost, FaztConfiguration, MonthlyConfiguration, StockValidationSnapshot],
        synchronize: false,
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([User, Order, OrderItem, Payment, Notification, Session,ProductAudit,Product]),
    OrderModule,
    AuthModule,
    NotificationModule,
    HttpModule,
    ProductsModule,
    MercadoLibreModule,
    InventoryModule

  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
