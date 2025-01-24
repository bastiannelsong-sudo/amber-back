import { Controller, Post, Get } from '@nestjs/common';
@Controller('notifications')
export class NotificationController {
    notificationService;
    constructor(notificationService) {
        this.notificationService = notificationService;
    }
    @Get()
    async getAll() {
        return this.notificationService.findAll();
    }
    @Post()
    async handleNotification(
    @Body()
    notification, 
    @Res()
    res) {
        try {
            // Guardar la notificación en la base de datos
            await this.notificationService.saveNotification(notification);
            // Responder al cliente con éxito después de guardar
            res.status(200).json({ message: 'Evento recibido con éxito' });
            // Procesar la notificación de manera asíncrona
            this.notificationService.handleNotificationAsync(notification);
        }
        catch (error) {
            console.error('Error al manejar la notificación:', error);
            res.status(500).json({ message: 'Error al manejar la notificación' });
        }
    }
}
