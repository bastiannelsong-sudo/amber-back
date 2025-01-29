import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { Notification } from './entities/notification.entity';
import { AuthModule } from '../auth/auth.module'; // Importa AuthModule
import { HttpModule } from '@nestjs/axios';
import { Session } from 'src/auth/entities/session.entity';
import { ConfigModule } from '@nestjs/config';
import { Order } from 'src/orders/entities/order.entity';
import { User } from 'src/orders/entities/user.entity';
import { OrderItem } from 'src/orders/entities/order-item.entity';
import { Payment } from 'src/orders/entities/payment.entity';
import { ProductAudit } from './entities/product-audit.entity';
import { Product } from '../products/entities/product.entity';


@Module({
  imports: [
    TypeOrmModule.forFeature([Notification,Session,Order,User,OrderItem,Payment,ProductAudit,Product]), // Registrar las entidades
    AuthModule,
    ConfigModule, // Asegura que ConfigModule esté importado
    HttpModule, // Importar el módulo de HTTP
  ],
  controllers: [NotificationController],
  providers: [NotificationService],
  exports: []
})
export class NotificationModule {}
