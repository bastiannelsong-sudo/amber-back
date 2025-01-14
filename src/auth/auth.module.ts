import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Session } from './entities/session.entity';
import { MercadoLibreAuthController } from './mercado-libre-auth.controller';
import { MercadoLibreAuthService } from './mercado-libre-auth.service';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    HttpModule,
    ConfigModule,
    TypeOrmModule.forFeature([Session]), // Registrar la entidad Session
  ],
  controllers: [MercadoLibreAuthController],
  providers: [MercadoLibreAuthService],
  exports: [TypeOrmModule], // Exportar TypeOrmModule para que otros módulos puedan acceder a SessionRepository
})
export class AuthModule {}
