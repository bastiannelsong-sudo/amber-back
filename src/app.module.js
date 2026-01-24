import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { User } from './orders/entities/user.entity';
import { Order } from './orders/entities/order.entity';
import { OrderItem } from './orders/entities/order-item.entity';
import { Payment } from './orders/entities/payment.entity';
import { OrderModule } from './orders/order.module';
import { AuthModule } from './auth/auth.module';
import { NotificationModule } from './notification/notification.module';
import { Notification } from './notification/entities/notification.entity';
import { Session } from './auth/entities/session.entity';
import { NotificationController } from './notification/notification.controller';
import { NotificationService } from './notification/notification.service';
import { HttpModule } from '@nestjs/axios';
import { AuditLog } from './notification/entities/audit-log.entity';
import { ProductsModule } from './products/products.module';
import { Product } from './products/entities/product.entity';
import { Platform } from './products/entities/platform.entity';
import { SecondarySku } from './products/entities/secondary-sku.entity';
import { Category } from './products/entities/category.entity';
@Module({
    imports: [
        ConfigModule.forRoot({
            isGlobal: true,
            envFilePath: '.env',
        }),
        TypeOrmModule.forRootAsync({
            imports: [ConfigModule],
            useFactory: (configService) => ({
                type: 'postgres',
                host: configService.get('DB_HOST'),
                port: configService.get('DB_PORT'),
                username: configService.get('DB_USERNAME'),
                password: configService.get('DB_PASSWORD'),
                database: configService.get('DB_DATABASE'),
                entities: [User, Order, OrderItem, Payment, Notification, Session, AuditLog, Product, Platform, SecondarySku, Category],
                synchronize: false,
            }),
            inject: [ConfigService],
        }),
        TypeOrmModule.forFeature([User, Order, OrderItem, Payment, Notification, Session, AuditLog]),
        OrderModule,
        AuthModule,
        NotificationModule,
        HttpModule,
        ProductsModule
    ],
    controllers: [NotificationController],
    providers: [NotificationService],
})
export class AppModule {
}
