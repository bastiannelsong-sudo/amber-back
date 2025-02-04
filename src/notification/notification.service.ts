import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
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
import { ProductAudit } from './entities/product-audit.entity';
import { Product } from '../products/entities/product.entity';


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
    @InjectRepository(ProductAudit)
    private readonly productAuditRepository: Repository<ProductAudit>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,


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
      if (this.isNotificationProcessed(notification)) return;

      console.log('Evento recibido:', notification);

      if (!this.isOrderNotification(notification)) return;

      const orderDetails = await this.getOrderDetails(notification);
      if (!this.shouldProcessOrder(orderDetails)) return;

      await this.processOrder(orderDetails);

      notification.processed = true;
      await this.notificationRepository.save(notification);

      console.log('Orden y detalles guardados correctamente.');
    } catch (error) {
      console.error('Error durante el procesamiento de la notificación:', error);
    }
  }


  private isNotificationProcessed(notification: Notification): boolean {
    if (notification.processed) {
      console.log('Notificación ya procesada, se omite...');
      return true;
    }
    return false;
  }


  private isOrderNotification(notification: Notification): boolean {
    return notification.topic.trim().toLowerCase() === 'orders_v2';
  }


  private shouldProcessOrder(orderDetails: any): boolean {
    const approvedPayments = orderDetails.payments.filter(
      payment => payment.status === 'approved'
    );

    if (approvedPayments.length === 0) {
      if (orderDetails.status === 'cancelled') {
        console.log('Seguir para revisar inventario.');
        return true;
      } else {
        console.log('No hay pagos aprobados. No se procesará la orden.');
        return false;
      }
    }

    return this.isApprovedDateValid(approvedPayments[0].date_approved);
  }

// ✅ Valida la fecha de aprobación del pago
  private isApprovedDateValid(dateApproved: string): boolean {
    const approvedDate = new Date(dateApproved);
    const minApprovedDate = new Date(process.env.MIN_APPROVED_DATE || '');

    if (isNaN(minApprovedDate.getTime())) {
      console.error('Error: MIN_APPROVED_DATE no está bien definida en el .env');
      return false;
    }

    if (approvedDate.getTime() < minApprovedDate.getTime()) {
      console.log(
        `La fecha de aprobación (${approvedDate}) es menor a la mínima permitida (${minApprovedDate}), se omite la orden.`
      );
      return false;
    }

    return true;
  }

  private async processOrder(orderDetails: any): Promise<void> {
    await this.saveBuyer(orderDetails.buyer);
    await this.saveSeller(orderDetails.seller);

    const order = await this.saveOrder(orderDetails);

    await this.saveOrderItems(orderDetails.order_items, order);
    await this.savePayments(orderDetails.payments, order);
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
        date_approved : new Date(orderDetails.date_approved ?? orderDetails.date_created),
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
        pack_id:orderDetails.pack_id,
      });


      const shippingId = orderDetails.shipping?.id;
      if (shippingId) {
        order.shipping_id = shippingId;
        try {
          order.logistic_type = await this.getLogisticType(orderDetails);
        } catch (error) {
          console.error('Error al obtener logistic_type:', error.message);
          order.logistic_type = 'Unknown';
        }
      }
    } else {

      order.date_approved = new Date(orderDetails.date_approved ?? orderDetails.date_created);

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
      order.pack_id = orderDetails.pack_id;

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
    const items = await Promise.all(
      orderItems.map(async (itemDetail) => {
        const { item, quantity, unit_price, full_unit_price, currency_id } = itemDetail;
        const { id: itemId, title, category_id, condition, warranty, seller_sku } = item;

        let orderItem = await this.orderItemRepository.createQueryBuilder('orderItem')
          .where('orderItem.item_id = :itemId', { itemId: itemDetail.item.id })
          .andWhere('orderItem.orderId = :orderId', { orderId: order.id })
          .getOne();

        if (!orderItem) {
          orderItem = this.orderItemRepository.create({
            order,
            item_id: itemId,
            title,
            category_id,
            quantity,
            unit_price,
            full_unit_price,
            currency_id,
            condition,
            warranty: warranty ?? '',
            seller_sku,
          });
        } else {
          Object.assign(orderItem, { title, category_id, quantity, unit_price, full_unit_price, currency_id, condition, warranty: warranty ?? '', seller_sku });
        }

        if (order.status === 'cancelled') {
          const existingAudit = await this.productAuditRepository.findOne({
            where: {
              order_id: order.id,
              status: In(['OK_INTERNO'])
            }
          });

          if (existingAudit) {
            await this.handleInventoryAndAudit(order, itemDetail);
          }
        }
        else{
          const existingAudit = await this.productAuditRepository.findOne({ where: { order_id: order.id } });

          if (!existingAudit) {
            await this.handleInventoryAndAudit(order, itemDetail);
          }
        }


        return orderItem;
      })
    );


    await this.orderItemRepository.save(items);
  }

  private async handleInventoryAndAudit(order: Order, itemDetail: any): Promise<void> {
    const { item, quantity } = itemDetail;
    const { seller_sku, id: mlSku } = item;

    const product = await this.findProduct(seller_sku, mlSku);
    if (!product) {
      return this.createAudit(order, seller_sku, mlSku, 'NOT_FOUND', 0, 'SKU no encontrado en el inventario');
    }

    if (order.logistic_type === 'fulfillment') {
      return this.createAudit(order, seller_sku, mlSku, 'OK_FULL', product.secondarySkus[0].stock_quantity);
    }

    const { quantityDiscounted, status, errorMessage } = this.processStockUpdate(order, product, quantity);
    await this.productRepository.save(product);
    await this.createAudit(order, seller_sku, mlSku, status, quantityDiscounted, errorMessage);
  }

  private async findProduct(seller_sku: string, mlSku: string): Promise<Product | null> {
    return this.productRepository.findOne({
      where: [{ internal_sku: seller_sku }, { internal_sku: mlSku }],
      relations: ['secondarySkus'],
    });
  }

  private processStockUpdate(
    order: Order,
    product: Product,
    quantity: number
  ): { quantityDiscounted: number; status: 'OK_INTERNO' | 'OK_FULL' | 'NOT_FOUND' | 'CANCELLED'; errorMessage?: string } {
    const stockItem = product.secondarySkus[0];

    if (order.status === 'cancelled') {
      product.stock += stockItem.stock_quantity * quantity;
      return { quantityDiscounted: -(stockItem.stock_quantity * quantity), status: 'CANCELLED' };
    }

    if (product.stock >= stockItem.stock_quantity * quantity) {
      product.stock -= stockItem.stock_quantity * quantity;
      return { quantityDiscounted: stockItem.stock_quantity * quantity, status: 'OK_INTERNO' };
    }

    return {
      quantityDiscounted: 0,
      status: 'NOT_FOUND',
      errorMessage: `Stock insuficiente: ${stockItem.stock_quantity * quantity}`,
    };
  }


  private async createAudit(
    order: Order,
    seller_sku: string,
    mlSku: string,
    status: 'OK_INTERNO' | 'OK_FULL' | 'NOT_FOUND' | 'CANCELLED',
    quantityDiscounted: number,
    errorMessage?: string
  ): Promise<void> {
    const audit = this.productAuditRepository.create({
      order_id: order.id,
      internal_sku: seller_sku,
      secondary_sku: mlSku,
      status:status,
      quantity_discounted: quantityDiscounted,
      error_message: errorMessage || null,
      logistic_type: order.logistic_type,
      platform_name: 'Mercado Libre',
    });

    await this.productAuditRepository.save(audit);
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

       session = await this.sessionRepository.findOne({
        where: { user_id: order.seller.id  },
      });

      if (!session) {
        console.log('No se encontró sesión activa para la orden:', order.seller.id);
        return 'Unknown';
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





}

