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
import { Session } from './auth/entities/session.entity';
import { NotificationController } from './notification/notification.controller';
import { NotificationService } from './notification/notification.service';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import * as path from 'path'; // Importar para resolver el path del archivo .env

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      username: 'postgres',
      password: '123456',
      database: 'amber',
      entities: [User, Order, OrderItem, Payment, Notification, Session],
      synchronize: true, // Solo en desarrollo, para producción deshabilitar esto
    }),
    TypeOrmModule.forFeature([User, Order, OrderItem, Payment, Notification, Session]),
    OrderModule,
    AuthModule,
    NotificationModule,
    HttpModule,
    
    // ConfigModule con configuración para cargar el archivo .env
    ConfigModule.forRoot({
      isGlobal: true, // Hace que las variables de entorno sean accesibles globalmente
      envFilePath: '.env', // Carga el archivo .env desde la raíz
    }),
  ],
  controllers: [NotificationController],
  providers: [NotificationService],
})
export class AppModule {}
