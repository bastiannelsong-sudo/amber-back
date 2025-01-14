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
    @Body() eventData: any,
    @Res() res: Response,
  ): Promise<any> {
    try {
      this.notificationService.handleNotification(eventData);

      return res.status(200).json({ message: 'Evento recibido con éxito' });
    } catch (error) {
      console.error('Error al manejar la notificación:', error);
      return res
        .status(500)
        .json({ message: 'Error al manejar la notificación' });
    }
  }
}

