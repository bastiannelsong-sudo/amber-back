import { Controller, Post, Get, Body, Res, Sse, Query, Param, Patch, Req, MessageEvent } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { NotificationGateway } from './notification.gateway';
import { Notification } from './entities/notification.entity';
import { Response, Request } from 'express';
import { Observable } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';

@Controller('notifications')
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly notificationGateway: NotificationGateway,
  ) {}

  // SSE stream para notificaciones en tiempo real
  @Sse('stream')
  stream(@Req() req: Request): Observable<MessageEvent> {
    const clientId = uuidv4();
    const subject = this.notificationGateway.addClient(clientId);

    req.on('close', () => {
      this.notificationGateway.removeClient(clientId);
    });

    return subject.asObservable();
  }

  // Ultimas notificaciones recientes
  @Get('recent')
  async getRecent(): Promise<Notification[]> {
    return this.notificationService.findRecent(10);
  }

  // Conteo de no leidas
  @Get('unread-count')
  async getUnreadCount(): Promise<{ count: number }> {
    const count = await this.notificationService.countUnread();
    return { count };
  }

  // Historial paginado con filtro de fecha
  @Get('history')
  async getHistory(
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
    @Query('from_date') fromDate?: string,
    @Query('to_date') toDate?: string,
  ) {
    return this.notificationService.findHistory(page, limit, fromDate, toDate);
  }

  // Marcar todas como leidas (ANTES de :id/read)
  @Patch('read-all')
  async markAllAsRead(): Promise<{ success: boolean; updated: number }> {
    const updated = await this.notificationService.markAllAsRead();
    return { success: true, updated };
  }

  // Marcar una como leida
  @Patch(':id/read')
  async markAsRead(@Param('id') id: string): Promise<{ success: boolean }> {
    await this.notificationService.markAsRead(id);
    return { success: true };
  }

  // Obtener todas las notificaciones
  @Get()
  async getAll(): Promise<Notification[]> {
    return this.notificationService.findAll();
  }

  // Webhook receptor de MercadoLibre
  @Post()
  async handleNotification(
    @Body() notification: Notification,
    @Res() res: Response,
  ): Promise<void> {
    try {
      await this.notificationService.saveNotification(notification);
      res.status(200).json({ message: 'Evento recibido con éxito' });
      this.notificationService.handleNotificationAsync(notification);
    } catch (error) {
      console.error('Error al manejar la notificación:', error);
      res.status(500).json({ message: 'Error al manejar la notificación' });
    }
  }
}
