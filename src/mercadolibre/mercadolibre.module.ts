import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MercadoLibreService } from './mercadolibre.service';
import { MercadoLibreController } from './mercadolibre.controller';
import { ConfigModule } from '@nestjs/config';
import { Session } from '../auth/entities/session.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from '../notification/entities/notification.entity';
import { Order } from '../orders/entities/order.entity';
import { User } from '../orders/entities/user.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { Payment } from '../orders/entities/payment.entity';
import { ProductAudit } from '../notification/entities/product-audit.entity';
import { Product } from '../products/entities/product.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  controllers: [MercadoLibreController],
  imports: [
    TypeOrmModule.forFeature([Session]), // Registrar las entidades
    AuthModule,
    ConfigModule, // Asegura que ConfigModule esté importado
    HttpModule, // Importar el módulo de HTTP
  ],
  providers: [MercadoLibreService],
})
export class MercadoLibreModule {}
