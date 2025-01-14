import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './orders/entities/user.entity';
import { Order } from './orders/entities/order.entity';
import { OrderItem } from './orders/entities/order-item.entity';
import { Payment } from './orders/entities/payment.entity';
import { OrderModule } from './orders/order.module';
import { AuthModule } from './auth/auth.module';
import { NotificationModule } from './notification/notification.module';
import { Notification } from './notification/entities/notification.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      username: 'postgres',
      password: '123456',
      database: 'amber',
      entities: [User, Order, OrderItem, Payment,Notification],
      synchronize: true, // Solo en desarrollo, para producción deshabilitar esto
    }),
    TypeOrmModule.forFeature([User, Order, OrderItem, Payment, Notification]),
    OrderModule,AuthModule,NotificationModule
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
