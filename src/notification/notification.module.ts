import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotificationService } from './notification.service';
import { NotificationController } from './notification.controller';
import { Notification } from './entities/notification.entity';
import { AuthModule } from '../auth/auth.module'; // Importa AuthModule
import { HttpModule } from '@nestjs/axios';
import { Session } from 'src/auth/entities/session.entity';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, Session]), // Registrar las entidades
    AuthModule, 
    ConfigModule, // Asegura que ConfigModule esté importado
    HttpModule, // Importar el módulo de HTTP
  ],
  controllers: [NotificationController],
  providers: [NotificationService],
})
export class NotificationModule {}
