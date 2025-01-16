import { Controller, Post, Get, Body, Res } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { Notification } from './entities/notification.entity';
import { Response } from 'express';

@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  async getAll(): Promise<Notification[]> {
    return this.notificationService.findAll();
  }


  @Post()
  async handleNotification(
    @Body() notification: Notification,
    @Res() res: Response,
  ): Promise<void> {
    try {
      // Guardar la notificación en la base de datos
      await this.notificationService.saveNotification(notification);

      // Responder al cliente con éxito después de guardar
      res.status(200).json({ message: 'Evento recibido con éxito' });

      // Procesar la notificación de manera asíncrona
      this.notificationService.handleNotificationAsync(notification);
    } catch (error) {
      console.error('Error al manejar la notificación:', error);
      res.status(500).json({ message: 'Error al manejar la notificación' });
    }
  }
}

