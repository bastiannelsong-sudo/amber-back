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
import { AuditService } from './audit.service';

@Injectable()
export class NotificationService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly apiUrl: string;

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
    private auditService:AuditService,
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
        return;
      }

      console.log('Evento recibido:', notification);

      if (notification.topic.trim().toLowerCase() === 'orders_v2') {
        const orderDetails = await this.getOrderDetails(notification);
        if (orderDetails.error) return;

        await this.saveBuyer(orderDetails.buyer);
        await this.saveSeller(orderDetails.seller);

        const order = await this.saveOrder(orderDetails);

        await this.saveOrderItems(orderDetails.order_items, order);
        await this.savePayments(orderDetails.payments, order);

        await this.detectAndLogOrderChanges(orderDetails, order);

        notification.processed = true;
        await this.notificationRepository.save(notification);

        console.log('Orden y detalles guardados correctamente.');
      }
    } catch (error) {
      console.error('Error durante el procesamiento de la notificación:', error);
    }
  }

  private async saveBuyer(buyerDetails: any): Promise<void> {
    let buyer = await this.userRepository.findOne({ where: { id: buyerDetails.id } });

    if (!buyer) {
      buyer = this.userRepository.create({
        id: buyerDetails.id,
        nickname: buyerDetails.nickname,
        first_name: buyerDetails.first_name,
        last_name: buyerDetails.last_name,
      });
    } else {
      buyer.nickname = buyerDetails.nickname;
      buyer.first_name = buyerDetails.first_name;
      buyer.last_name = buyerDetails.last_name;
    }

    await this.userRepository.save(buyer);
  }

  private async saveSeller(sellerDetails: any): Promise<void> {
    let seller = await this.userRepository.findOne({ where: { id: sellerDetails.id } });

    if (!seller) {
      seller = this.userRepository.create({
        id: sellerDetails.id
      });
    }


    await this.userRepository.save(seller);
  }

  private async saveOrder(orderDetails: any): Promise<Order> {
    let order = await this.orderRepository.findOne({
      where: { id: orderDetails.id },
      relations: ['buyer', 'seller', 'items', 'items.order', 'payments'],
    });

    if (!order) {
      // Si la orden no existe, se crea una nueva
      order = this.orderRepository.create({
        id: orderDetails.id,
        date_created: new Date(orderDetails.date_created),
        last_updated: new Date(orderDetails.last_updated),
        expiration_date: orderDetails.expiration_date ? new Date(orderDetails.expiration_date) : null,
        date_closed: orderDetails.date_closed ? new Date(orderDetails.date_closed) : null,
        status: orderDetails.status,
        tags: orderDetails.tags,
        total_amount: orderDetails.total_amount,
        paid_amount: orderDetails.paid_amount,
        currency_id: orderDetails.currency_id,
        buyer: orderDetails.buyer,
        seller: orderDetails.seller,
        fulfilled: orderDetails.fulfilled ?? false,
      });

      // Llamar a la API para obtener el logistic_type al crear la orden
      const shippingId = orderDetails.shipping?.id;
      if (shippingId) {
        order.shipping_id = shippingId;
        try {
          const logisticType = await this.getLogisticType(orderDetails);
          order.logistic_type = logisticType;
        } catch (error) {
          console.error('Error al obtener logistic_type:', error.message);
          order.logistic_type = 'Unknown';
        }
      }
    } else {

      order.date_created = new Date(orderDetails.date_created);
      order.last_updated = new Date(orderDetails.last_updated);
      order.expiration_date = orderDetails.expiration_date ? new Date(orderDetails.expiration_date) : null;
      order.date_closed = orderDetails.date_closed ? new Date(orderDetails.date_closed) : null;
      order.status = orderDetails.status;
      order.total_amount = orderDetails.total_amount;
      order.paid_amount = orderDetails.paid_amount;
      order.tags = orderDetails.tags;
      order.currency_id = orderDetails.currency_id;
      order.buyer = orderDetails.buyer;
      order.seller = orderDetails.seller;
      order.fulfilled = orderDetails.fulfilled ?? false;

      // Si el shipping_id ha cambiado, llamamos a la API para obtener el logistic_type
      const shippingId = orderDetails.shipping?.id;
      if (shippingId && shippingId !== order.shipping_id) {
        order.shipping_id = shippingId;
        try {
          const logisticType = await this.getLogisticType(orderDetails);
          order.logistic_type = logisticType;
        } catch (error) {
          console.error('Error al obtener logistic_type:', error.message);
          order.logistic_type = 'Unknown'; // Asignamos un valor por defecto en caso de error
        }
      }
    }

    // Guardar la orden en la base de datos
    await this.orderRepository.save(order);

    return order;
  }

  private async saveOrderItems(orderItems: any[], order: Order): Promise<void> {
    const items = await Promise.all(orderItems.map(async (itemDetail: any) => {
      let item = await this.orderItemRepository.createQueryBuilder('orderItem')
        .where('orderItem.item_id = :itemId', { itemId: itemDetail.item.id })
        .andWhere('orderItem.orderId = :orderId', { orderId: order.id }).
        getOne();

      if (!item) {
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
          warranty: itemDetail.item.warranty ?? '',
        });
      } else {
        item.title = itemDetail.item.title;
        item.category_id = itemDetail.item.category_id;
        item.quantity = itemDetail.quantity;
        item.unit_price = itemDetail.unit_price;
        item.full_unit_price = itemDetail.full_unit_price;
        item.currency_id = itemDetail.currency_id;
        item.condition = itemDetail.item.condition;
        item.warranty = itemDetail.item.warranty ?? '';
      }

      return item;
    }));

    await this.orderItemRepository.save(items);
  }

  private async savePayments(payments: any[], order: Order): Promise<void> {
    const paymentPromises = payments.map(async (paymentDetail: any) => {
      let payment = await this.paymentRepository.findOne({ where: { id: paymentDetail.id } });

      if (!payment) {
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
      } else {
        payment.payment_method_id = paymentDetail.payment_method_id;
        payment.payment_type = paymentDetail.payment_type;
        payment.status = paymentDetail.status;
        payment.transaction_amount = paymentDetail.transaction_amount;
        payment.shipping_cost = paymentDetail.shipping_cost;
        payment.marketplace_fee = paymentDetail.marketplace_fee;
        payment.total_paid_amount = paymentDetail.total_paid_amount;
        payment.date_approved = new Date(paymentDetail.date_approved);
        payment.currency_id = paymentDetail.currency_id;
      }

      return payment;
    });

    await this.paymentRepository.save(await Promise.all(paymentPromises));
  }

  private async detectAndLogOrderChanges(oldOrder: Order, newOrder: Order): Promise<void> {
    // Esperamos que detectChanges termine antes de continuar.
    const orderChanges = await this.detectChanges(oldOrder, newOrder);

    // Logueamos el cambio de la orden.
    await this.auditService.logAudit('order: ' + newOrder.id, 'update', { order: orderChanges });
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

  private async getLogisticType(order: Order): Promise<string> {
    let session: Session | null = null;
    try {
      // Buscar la sesión activa para el usuario asociado a la orden
      session = await this.sessionRepository.findOne({
        where: { user_id: order.seller.id  },
      });

      if (!session) {
        console.log('No se encontró sesión activa para la orden:', order.seller.id);
        return 'Unknown'; // Si no se encuentra la sesión, devolvemos un valor por defecto
      }

      
      const accessToken = session.access_token;
      console.log('Intentando acceder con el token:', accessToken);

  
      const response: AxiosResponse = await firstValueFrom(
        this.httpService.get(`https://api.mercadolibre.com/orders/${order.id}/shipments`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }),
      );
      
      return response.data.logistic_type;
    } catch (error) {
     
        console.error('Error al obtener logistic_type:', error.message);
        return 'Unknown'; 
      
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

  async detectChanges(oldEntity: any, newEntity: any): Promise<EntityChanges> {
    const changes: EntityChanges = {};

    // Define propiedades que no quieres comparar
    const excludedProperties = ['someExcludedProperty', 'anotherExcludedProperty'];

    for (let key in newEntity) {
      // Omitir propiedades excluidas
      if (excludedProperties.includes(key)) {
        continue;
      }

      const oldValue = oldEntity[key];
      const newValue = newEntity[key];

      // Verificar si ambos valores son objetos
      if (this.isObject(newValue) && this.isObject(oldValue)) {
        if (!this.deepEqual(oldValue, newValue)) {
          changes[key] = {
            column: key,
            oldValue: oldValue,
            newValue: newValue,
          };
        }
      }
      // Verificar si ambos valores son arrays
      else if (Array.isArray(newValue) && Array.isArray(oldValue)) {
        if (!this.deepEqual(oldValue, newValue)) {
          changes[key] = {
            column: key,
            oldValue: oldValue,
            newValue: newValue,
          };
        }
      }
      // Comparar fechas, teniendo en cuenta las zonas horarias
      else if (newValue instanceof Date && oldValue instanceof Date) {
        if (this.areDatesDifferent(oldValue, newValue)) {
          changes[key] = {
            column: key,
            oldValue: oldValue.toISOString(),
            newValue: newValue.toISOString(),
          };
        }
      }
      // Comparar valores booleanos
      else if (typeof newValue === 'boolean' && typeof oldValue === 'boolean') {
        if (newValue !== oldValue) {
          changes[key] = {
            column: key,
            oldValue: oldValue,
            newValue: newValue,
          };
        }
      }
      // Comparación de valores numéricos (montos)
      else if (typeof newValue === 'number' && typeof oldValue === 'number') {
        if (newValue !== oldValue) {
          changes[key] = {
            column: key,
            oldValue: oldValue,
            newValue: newValue,
          };
        }
      }
      // Comparación de valores representados como cadenas numéricas
      else if ((typeof newValue === 'string' || typeof oldValue === 'string') && !isNaN(parseFloat(newValue))) {
        const oldAmount = parseFloat(oldValue);
        const newAmount = parseFloat(newValue);
        if (oldAmount !== newAmount) {
          changes[key] = {
            column: key,
            oldValue: oldAmount,
            newValue: newAmount,
          };
        }
      }
      // Comparación de valores normales
      else if (newValue !== oldValue) {
        if (newValue !== null && oldValue !== null && newValue !== undefined && oldValue !== undefined) {
          changes[key] = {
            column: key,
            oldValue: oldValue,
            newValue: newValue,
          };
        }
      }
    }

    return changes;
  }

// Función para verificar si el valor es un objeto
  private isObject(value: any): boolean {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

// Función para comparar objetos y arrays de manera profunda
  private deepEqual(a: any, b: any): boolean {
    if (a === b) return true;

    if (this.isObject(a) && this.isObject(b)) {
      const keysA = Object.keys(a);
      const keysB = Object.keys(b);

      if (keysA.length !== keysB.length) return false;

      return keysA.every((key) => this.deepEqual(a[key], b[key]));
    }

    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((item, index) => this.deepEqual(item, b[index]));
    }

    return false;
  }

// Función para comparar fechas de manera robusta, teniendo en cuenta las zonas horarias
  private areDatesDifferent(oldDate: Date, newDate: Date): boolean {
    // Compara las fechas en formato ISO, que es independiente de la zona horaria
    return oldDate.toISOString() !== newDate.toISOString();
  }




}

