import { Controller, Post, Get, Body } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { Notification } from './entities/notification.entity';

@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Post()
  async create(@Body() data: Partial<Notification>): Promise<Notification> {
    return this.notificationService.saveNotification(data);
  }

  @Get()
  async getAll(): Promise<Notification[]> {
    return this.notificationService.findAll();
  }
}
