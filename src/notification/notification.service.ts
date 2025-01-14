import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from './entities/notification.entity';

@Injectable()
export class NotificationService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
  ) {}

  async saveNotification(data: Partial<Notification>): Promise<Notification> {
    const notification = this.notificationRepository.create(data);
    return this.notificationRepository.save(notification);
  }

  async findAll(): Promise<Notification[]> {
    return this.notificationRepository.find();
  }

  async handleNotification(eventData: any): Promise<void> {
    // Loguear el evento recibido
    console.log('Evento recibido:', eventData);
  
    // Extraer información importante del evento
    const { topic, resource, user_id, application_id, sent, attempts, received, actions } = eventData;
  
    // Crear y guardar la notificación en la base de datos
    const notification = this.notificationRepository.create({
      topic,
      resource,
      user_id,
      application_id,
      sent: new Date(sent),
      attempts,
      received: new Date(received),
      actions,
    });
    await this.notificationRepository.save(notification);
  
    // Procesar la notificación según el tipo de acción
    if (resource?.status === 'approved' && resource?.order_items) {
      resource.order_items.forEach((item: any) => {
        const itemId = item.item_id;
        const quantity = item.quantity;
  
        // Lógica para descontar el stock (puedes añadir aquí la lógica real)
        console.log(`Descontar stock: item_id=${itemId}, quantity=${quantity}`);
      });
    }
  }
  
}
