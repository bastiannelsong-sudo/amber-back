import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Session } from './entities/session.entity';
import { MercadoLibreAuthController } from './mercado-libre-auth.controller';
import { MercadoLibreAuthService } from './mercado-libre-auth.service';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { SessionCacheService } from './session-cache.service';

@Module({
  imports: [
    HttpModule,
    ConfigModule,
    TypeOrmModule.forFeature([Session]),
  ],
  controllers: [MercadoLibreAuthController],
  providers: [MercadoLibreAuthService, SessionCacheService],
  exports: [TypeOrmModule],
})
export class AuthModule {}
