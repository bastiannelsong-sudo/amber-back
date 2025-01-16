import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from './entities/notification.entity';
import { HttpService } from '@nestjs/axios';
import { AxiosResponse } from 'axios';
import { Session } from 'src/auth/entities/session.entity';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { User } from 'src/orders/entities/user.entity';
import { Order } from 'src/orders/entities/order.entity';
import { Payment } from 'src/orders/entities/payment.entity';
import { OrderItem } from 'src/orders/entities/order-item.entity';

@Injectable()
export class NotificationService {
  private clientId: string;
  private clientSecret: string;
  private apiUrl: string;

  private refreshAttemptCount: number = 0;

  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    @InjectRepository(Session)
    private readonly sessionRepository: Repository<Session>,
    
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,


    private readonly httpService: HttpService,
    private configService: ConfigService,
  ) {
    this.clientId = this.configService.get<string>('CLIENT_ID');
    this.clientSecret = this.configService.get<string>('CLIENT_SECRET');
    this.apiUrl = this.configService.get<string>('MERCADO_LIBRE_API_URL');

    if (!this.clientId || !this.clientSecret || !this.apiUrl) {
      throw new Error(
        'Faltan las variables de configuración necesarias (CLIENT_ID, CLIENT_SECRET)',
      );
    }

    console.log('CLIENT_ID:', this.clientId);
    console.log('CLIENT_SECRET:', this.clientSecret);
  }

  async saveNotification(data: Partial<Notification>): Promise<Notification> {
    const existingNotification = await this.notificationRepository.findOne({
      where: { id: data.id }, // Si la notificación tiene un ID único
    });
  
    if (existingNotification) {
      return existingNotification; // Si ya existe, no la guardes de nuevo
    }
  
    const notification = this.notificationRepository.create(data);
    return this.notificationRepository.save(notification);
  }

  async findAll(): Promise<Notification[]> {
    return this.notificationRepository.find();
  }
  async handleNotificationAsync(notification: Notification): Promise<void> {
    try {
      if (notification.processed) {
        console.log('Notificación ya procesada, se omite...');
        return; // Evitar procesar notificaciones ya procesadas
      }
      console.log('Evento recibido:', notification);

      
  
      const orderDetails = await this.getOrderDetails(notification);
  
      // Guardar o actualizar el comprador (buyer)
      let buyer = await this.userRepository.findOne({ where: { id: orderDetails.buyer.id } });
      if (buyer) {
        // Si existe, actualizar los detalles del comprador
        buyer.nickname = orderDetails.buyer.nickname;
        buyer.first_name = orderDetails.buyer.first_name;
        buyer.last_name = orderDetails.buyer.last_name;
      } else {
        // Si no existe, crear un nuevo comprador
        buyer = this.userRepository.create({
          id: orderDetails.buyer.id,
          nickname: orderDetails.buyer.nickname,
          first_name: orderDetails.buyer.first_name,
          last_name: orderDetails.buyer.last_name,
        });
      }
      await this.userRepository.save(buyer); // `save` manejará tanto creación como actualización
  
      // Guardar o actualizar el vendedor (seller)
      let seller = await this.userRepository.findOne({ where: { id: orderDetails.seller.id } });
      if (seller) {
        // Si existe, actualizar los detalles del vendedor
        seller.nickname = 'null'; // Se proporciona 'null' si no se encuentra en los detalles
        seller.first_name = 'null';
        seller.last_name = 'null';
      } else {
        // Si no existe, crear un nuevo vendedor
        seller = this.userRepository.create({
          id: orderDetails.seller.id,
          nickname: 'null',
          first_name: 'null',
          last_name: 'null',
        });
      }
      await this.userRepository.save(seller); // `save` manejará tanto creación como actualización
  
      // Guardar o actualizar la orden
      let order = await this.orderRepository.findOne({ where: { id: orderDetails.id } });
      if (order) {
        // Si la orden existe, actualizar los campos
        order.date_created = new Date(orderDetails.date_created);
        order.last_updated = new Date(orderDetails.last_updated);
        order.expiration_date = orderDetails.expiration_date ? new Date(orderDetails.expiration_date) : null;
        order.date_closed = orderDetails.date_closed ? new Date(orderDetails.date_closed) : null;
        order.status = orderDetails.status;
        order.total_amount = orderDetails.total_amount;
        order.paid_amount = orderDetails.paid_amount;
        order.currency_id = orderDetails.currency_id;
        order.buyer = buyer; // Asegúrate de que los objetos buyer y seller estén asignados
        order.seller = seller;
      } else {
        // Si no existe, crear una nueva orden
        order = this.orderRepository.create({
          id: orderDetails.id,
          date_created: new Date(orderDetails.date_created),
          last_updated: new Date(orderDetails.last_updated),
          expiration_date: orderDetails.expiration_date ? new Date(orderDetails.expiration_date) : null,
          date_closed: orderDetails.date_closed ? new Date(orderDetails.date_closed) : null,
          status: orderDetails.status,
          total_amount: orderDetails.total_amount,
          paid_amount: orderDetails.paid_amount,
          currency_id: orderDetails.currency_id,
          buyer: buyer,
          seller: seller,
        });
      }
      await this.orderRepository.save(order); // `save` manejará tanto creación como actualización
  
      // Guardar o actualizar los items de la orden
      const items = await Promise.all(orderDetails.order_items.map(async (itemDetail: any) => {
        let item = await this.orderItemRepository.findOne({ where: { item_id: itemDetail.item.id, order: order } });
        if (item) {
          // Si el item ya existe, actualizar los detalles
          item.title = itemDetail.item.title;
          item.category_id = itemDetail.item.category_id;
          item.quantity = itemDetail.quantity;
          item.unit_price = itemDetail.unit_price;
          item.full_unit_price = itemDetail.full_unit_price;
          item.currency_id = itemDetail.currency_id;
          item.condition = itemDetail.item.condition;
          item.warranty = itemDetail.item.warranty || '';
        } else {
          // Si no existe, crear un nuevo item
          item = this.orderItemRepository.create({
            order: order,
            item_id: itemDetail.item.id,
            title: itemDetail.item.title,
            category_id: itemDetail.item.category_id,
            quantity: itemDetail.quantity,
            unit_price: itemDetail.unit_price,
            full_unit_price: itemDetail.full_unit_price,
            currency_id: itemDetail.currency_id,
            condition: itemDetail.item.condition,
            warranty: itemDetail.item.warranty || '',
          });
        }
        return item;
      }));
      await this.orderItemRepository.save(items); // `save` manejará tanto creación como actualización
  
      // Guardar o actualizar los pagos de la orden
      const payments = await Promise.all(orderDetails.payments.map(async (paymentDetail: any) => {
        let payment = await this.paymentRepository.findOne({ where: { id: paymentDetail.id, order: order } });
        if (payment) {
          // Si el pago ya existe, actualizar los detalles
          payment.payment_method_id = paymentDetail.payment_method_id;
          payment.payment_type = paymentDetail.payment_type;
          payment.status = paymentDetail.status;
          payment.transaction_amount = paymentDetail.transaction_amount;
          payment.shipping_cost = paymentDetail.shipping_cost;
          payment.marketplace_fee = paymentDetail.marketplace_fee;
          payment.total_paid_amount = paymentDetail.total_paid_amount;
          payment.date_approved = new Date(paymentDetail.date_approved);
          payment.currency_id = paymentDetail.currency_id;
        } else {
          // Si no existe, crear un nuevo pago
          payment = this.paymentRepository.create({
            id: paymentDetail.id,
            order: order,
            payment_method_id: paymentDetail.payment_method_id,
            payment_type: paymentDetail.payment_type,
            status: paymentDetail.status,
            transaction_amount: paymentDetail.transaction_amount,
            shipping_cost: paymentDetail.shipping_cost,
            marketplace_fee: paymentDetail.marketplace_fee,
            total_paid_amount: paymentDetail.total_paid_amount,
            date_approved: new Date(paymentDetail.date_approved),
            currency_id: paymentDetail.currency_id,
          });
        }
        return payment;
      }));
      await this.paymentRepository.save(payments); // `save` manejará tanto creación como actualización
      notification.processed = true;
      await this.notificationRepository.save(notification);
  
      console.log('Orden y detalles guardados correctamente.');
    } catch (error) {
      console.error('Error durante el procesamiento de la notificación:', error);
    }
  }
  
  

  private async getOrderDetails(notification: Notification): Promise<any> {
    let session: Session | null = null;
    try {
      session = await this.sessionRepository.findOne({
        where: { user_id: notification.user_id },
      });

      if (!session) {
        console.log(
          'No se encontró sesión activa para el usuario:',
          notification.user_id,
        );
        return { error: 'No se encontró sesión activa' };
      }

      const accessToken = session.access_token;
      console.log('Intentando acceder con el token:', accessToken);

      const response: AxiosResponse = await firstValueFrom(
        this.httpService.get(`${this.apiUrl}${notification.resource}`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }),
      );

      return response.data;
    } catch (error) {
      if (error.response?.status === 401) {
        console.log('401: El token ha expirado. Intentando hacer refresh...');
        return this.handleTokenRefresh(session, notification);
      } else {
        console.error('Error en la solicitud:', error.message);
      }
    }
  }

  private async handleTokenRefresh(
    session: Session,
    notification: Notification,
  ): Promise<any> {
    if (this.refreshAttemptCount >= 1) {
      console.log(
        'Se ha intentado refrescar el token anteriormente. No se intentará más.',
      );
      return { error: 'Máximo de intentos de refresco alcanzado' };
    }

    const refreshToken = session.refresh_token;
    try {
      this.refreshAttemptCount++;

      console.log('Intentando refrescar el token...');
      const newTokens = await this.refreshAccessToken(refreshToken);

      await this.sessionRepository.update(session.id, {
        access_token: newTokens.access_token,
        expires_in: newTokens.expires_in,
        refresh_token: newTokens.refresh_token,
        updated_at: new Date(), // Establecer manualmente la fecha de actualización
      });

      this.refreshAttemptCount = 0;
      return this.getOrderDetails(notification); // Intentar nuevamente con el nuevo token
    } catch (refreshError) {
      console.error('No se pudo refrescar el token:', refreshError.message);
      return { error: 'Error al refrescar el token' };
    }
  }

  private async refreshAccessToken(refreshToken: string): Promise<any> {
    try {
      console.log('Realizando solicitud para refrescar el token...' + refreshToken);
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.apiUrl}/oauth/token`,
          new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: this.clientId,
            client_secret: this.clientSecret,
            refresh_token: refreshToken,
          }).toString(),
        ),
      );

      return response.data;
    } catch (error) {
      console.error('Error al obtener nuevo access_token:', error.message);
    }
  }
}

