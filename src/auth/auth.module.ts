import { Module } from '@nestjs/common';
import { MercadoLibreAuthController } from './mercado-libre-auth.controller'
import { MercadoLibreAuthService } from './mercado-libre-auth.service'
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { NotificationModule } from 'src/notification/notification.module';

@Module({
  imports: [HttpModule, ConfigModule,NotificationModule], // Importa HttpModule para hacer solicitudes HTTP a Mercado Libre
  controllers: [MercadoLibreAuthController],
  providers: [MercadoLibreAuthService ],
})
export class AuthModule {}
