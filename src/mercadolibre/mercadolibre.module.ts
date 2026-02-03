import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MercadoLibreService } from './mercadolibre.service';
import { MercadoLibreController } from './mercadolibre.controller';
import { ConfigModule } from '@nestjs/config';
import { Session } from '../auth/entities/session.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Product } from '../products/entities/product.entity';
import { SecondarySku } from '../products/entities/secondary-sku.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  controllers: [MercadoLibreController],
  imports: [
    TypeOrmModule.forFeature([Session, Product, SecondarySku]),
    AuthModule,
    ConfigModule,
    HttpModule,
  ],
  providers: [MercadoLibreService],
  exports: [MercadoLibreService],
})
export class MercadoLibreModule {}
