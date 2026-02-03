import { Controller, Post, Body, Res, Logger } from '@nestjs/common';
import { FalabellaNotificationService, FalabellaNotificationPayload } from './falabella-notification.service';
import { Response } from 'express';

@Controller('notifications/falabella')
export class FalabellaNotificationController {
  private readonly logger = new Logger(FalabellaNotificationController.name);

  constructor(
    private readonly falabellaService: FalabellaNotificationService,
  ) {}

  @Post()
  async handleNotification(
    @Body() payload: FalabellaNotificationPayload,
    @Res() res: Response,
  ): Promise<void> {
    try {
      this.logger.log(`Recibida notificación Falabella: orden ${payload.order_id}, items: ${payload.items?.length || 0}`);

      // Responder 200 inmediatamente
      res.status(200).json({ message: 'Notificación recibida' });

      // Procesar asincrónicamente
      this.falabellaService.processNotification(payload).catch(error => {
        this.logger.error(`Error procesando notificación Falabella: ${error.message}`, error.stack);
      });
    } catch (error) {
      this.logger.error('Error al manejar notificación Falabella:', error);
      res.status(500).json({ message: 'Error al manejar la notificación' });
    }
  }
}
