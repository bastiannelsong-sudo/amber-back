import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
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
import { InventoryService } from '../products/services/inventory.service';
import { PendingSalesService } from './services/pending-sales.service';
import { Platform } from '../products/entities/platform.entity';


@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly apiUrl: string;

  private mlPlatformId: number | null = null;
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

    private readonly dataSource: DataSource,
    private readonly inventoryService: InventoryService,
    private readonly pendingSalesService: PendingSalesService,

    private readonly httpService: HttpService,
    private configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,

  ) {
    this.clientId = this.configService.get<string>('CLIENT_ID');
    this.clientSecret = this.configService.get<string>('CLIENT_SECRET');
    this.apiUrl = this.configService.get<string>('MERCADO_LIBRE_API_URL');

    if (!this.clientId || !this.clientSecret || !this.apiUrl) {
      throw new Error(
        'Faltan las variables de configuración necesarias (CLIENT_ID, CLIENT_SECRET)',
      );
    }
  }

  /**
   * Obtener el platform_id de Mercado Libre (cached)
   */
  private async getMlPlatformId(): Promise<number | null> {
    if (this.mlPlatformId !== null) return this.mlPlatformId;

    const platformRepo = this.dataSource.getRepository(Platform);
    const platform = await platformRepo.findOne({
      where: { platform_name: 'Mercado Libre' },
    });

    if (platform) {
      this.mlPlatformId = platform.platform_id;
    }

    return this.mlPlatformId;
  }

  async saveNotification(data: Partial<Notification>): Promise<Notification> {
    const existingNotification = await this.notificationRepository.findOne({
      where: { id: data.id },
    });

    if (existingNotification) {
      return existingNotification;
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

      // Enriquecer notificacion con datos de la orden
      this.enrichNotification(notification, orderDetails);

      notification.processed = true;
      await this.notificationRepository.save(notification);

      // Emitir evento SSE para clientes conectados
      this.eventEmitter.emit('notification.processed', {
        id: notification.id,
        event_type: notification.event_type,
        summary: notification.summary,
        product_name: notification.product_name,
        seller_sku: notification.seller_sku,
        total_amount: notification.total_amount,
        currency_id: notification.currency_id,
        order_id: notification.order_id,
        order_status: notification.order_status,
        topic: notification.topic,
        received: notification.received,
      });

      console.log('Orden y detalles guardados correctamente.');
    } catch (error) {
      console.error('Error durante el procesamiento de la notificación:', error);
    }
  }

  private enrichNotification(notification: Notification, orderDetails: any): void {
    const firstItem = orderDetails.order_items?.[0];

    notification.order_id = orderDetails.id;
    notification.order_status = orderDetails.status;
    notification.total_amount = orderDetails.total_amount;
    notification.currency_id = orderDetails.currency_id;
    notification.product_name = firstItem?.item?.title || null;
    notification.seller_sku = firstItem?.item?.seller_sku || null;

    if (orderDetails.status === 'cancelled') {
      notification.event_type = 'order_cancelled';
    } else {
      notification.event_type = 'new_order';
    }

    const quantity = firstItem?.quantity || 0;
    const productName = notification.product_name || 'Producto desconocido';
    const amount = notification.total_amount
      ? `$${Number(notification.total_amount).toLocaleString('es-CL')}`
      : '';
    const extraItems = orderDetails.order_items?.length > 1
      ? ` (+${orderDetails.order_items.length - 1} mas)`
      : '';

    if (notification.event_type === 'order_cancelled') {
      notification.summary = `Orden cancelada: ${productName} x${quantity}${extraItems} - ${amount}`;
    } else {
      notification.summary = `Nueva venta: ${productName} x${quantity}${extraItems} - ${amount}`;
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
        nickname: buyerDetails.nickname || `buyer_${buyerDetails.id}`,
        first_name: buyerDetails.first_name || '',
        last_name: buyerDetails.last_name || '',
      });
    } else {
      buyer.nickname = buyerDetails.nickname || buyer.nickname;
      buyer.first_name = buyerDetails.first_name || buyer.first_name;
      buyer.last_name = buyerDetails.last_name || buyer.last_name;
    }

    await this.userRepository.save(buyer);
  }

  private async saveSeller(sellerDetails: any): Promise<void> {
    let seller = await this.userRepository.findOne({ where: { id: sellerDetails.id } });

    if (!seller) {
      seller = this.userRepository.create({
        id: sellerDetails.id,
        nickname: sellerDetails.nickname || `user_${sellerDetails.id}`,
        first_name: sellerDetails.first_name || '',
        last_name: sellerDetails.last_name || '',
      });
      await this.userRepository.save(seller);
    }
  }

  private async saveOrder(orderDetails: any): Promise<Order> {
    let order = await this.orderRepository.findOne({
      where: { id: orderDetails.id },
      relations: ['buyer', 'seller', 'items', 'items.order', 'payments'],
    });

    if (!order) {
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

      const shippingId = orderDetails.shipping?.id;
      if (shippingId && shippingId !== order.shipping_id) {
        order.shipping_id = shippingId;
        try {
          const logisticType = await this.getLogisticType(orderDetails);
          order.logistic_type = logisticType;
        } catch (error) {
          console.error('Error al obtener logistic_type:', error.message);
          order.logistic_type = 'Unknown';
        }
      }
    }

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

    // Fulfillment orders never deduct stock or create pending sales
    if (order.logistic_type === 'fulfillment') {
      return this.createAudit(order, seller_sku, String(mlSku), 'OK_FULL', quantity);
    }

    const platformId = await this.getMlPlatformId();

    let product: Product | null = null;
    if (platformId) {
      product = await this.inventoryService.findProductBySku(platformId, seller_sku);
      if (!product && mlSku) {
        product = await this.inventoryService.findProductBySku(platformId, String(mlSku));
      }
    }

    if (!product) {
      product = await this.productRepository.findOne({
        where: [{ internal_sku: seller_sku }, { internal_sku: String(mlSku) }],
        relations: ['secondarySkus'],
      });
    }

    if (!product) {
      if (platformId) {
        try {
          await this.pendingSalesService.create({
            platform_id: platformId,
            platform_order_id: String(order.id),
            platform_sku: seller_sku || String(mlSku),
            quantity: quantity,
            sale_date: order.date_approved,
            raw_data: { item, quantity, order_id: order.id, logistic_type: order.logistic_type },
          });
          this.logger.log(`PendingSale creado para orden ${order.id}, SKU: ${seller_sku || mlSku}`);
        } catch (error) {
          this.logger.warn(`No se pudo crear PendingSale para orden ${order.id}: ${error.message}`);
        }
      }

      return this.createAudit(order, seller_sku, String(mlSku), 'NOT_FOUND', 0, 'SKU no encontrado en el inventario');
    }

    const metadata = {
      change_type: 'order' as const,
      changed_by: 'Sistema ML',
      change_reason: order.status === 'cancelled'
        ? `Cancelación orden ML #${order.id} - stock restaurado`
        : `Venta orden ML #${order.id}`,
      platform_id: platformId || undefined,
      platform_order_id: String(order.id),
      metadata: { logistic_type: order.logistic_type },
    };

    if (order.status === 'cancelled') {
      try {
        await this.inventoryService.restoreStock(product.product_id, quantity, metadata);
        await this.createAudit(order, seller_sku, String(mlSku), 'CANCELLED', -quantity);
      } catch (error) {
        this.logger.error(`Error restaurando stock para orden ${order.id}: ${error.message}`);
        await this.createAudit(order, seller_sku, String(mlSku), 'NOT_FOUND', 0, `Error restaurando stock: ${error.message}`);
      }
      return;
    }

    const hasStock = await this.inventoryService.validateStockAvailability(product.product_id, quantity);
    if (!hasStock) {
      await this.createAudit(order, seller_sku, String(mlSku), 'NOT_FOUND', 0, `Stock insuficiente para descontar ${quantity} unidades`);
      return;
    }

    try {
      await this.inventoryService.deductStock(product.product_id, quantity, metadata);
      await this.createAudit(order, seller_sku, String(mlSku), 'OK_INTERNO', quantity);
    } catch (error) {
      this.logger.error(`Error descontando stock para orden ${order.id}: ${error.message}`);
      await this.createAudit(order, seller_sku, String(mlSku), 'NOT_FOUND', 0, `Error descontando stock: ${error.message}`);
    }
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

  private extractIva(priceWithIva: number): number {
    const IVA_RATE = 19;
    const IVA_DIVISOR = 100 + IVA_RATE;
    return Math.round((priceWithIva * IVA_RATE) / IVA_DIVISOR);
  }

  private async savePayments(payments: any[], order: Order): Promise<void> {
    console.log(`[NotificationService] Payments for order ${order.id}:`, JSON.stringify(payments, null, 2));

    const paymentPromises = payments.map(async (paymentDetail: any) => {
      let payment = await this.paymentRepository.findOne({ where: { id: paymentDetail.id } });

      const transactionAmount = paymentDetail.transaction_amount || 0;
      const ivaAmount = this.extractIva(transactionAmount);
      const finalMarketplaceFee = paymentDetail.marketplace_fee || 0;
      console.log(`[NotificationService] Order ${order.id}: marketplace_fee=${finalMarketplaceFee}, shipping=${paymentDetail.shipping_cost}`);

      if (!payment) {
        payment = this.paymentRepository.create({
          id: paymentDetail.id,
          order: order,
          payment_method_id: paymentDetail.payment_method_id,
          payment_type: paymentDetail.payment_type,
          status: paymentDetail.status,
          transaction_amount: transactionAmount,
          shipping_cost: paymentDetail.shipping_cost,
          marketplace_fee: finalMarketplaceFee,
          iva_amount: ivaAmount,
          total_paid_amount: paymentDetail.total_paid_amount,
          date_approved: new Date(paymentDetail.date_approved),
          currency_id: paymentDetail.currency_id,
        });
      } else {
        payment.payment_method_id = paymentDetail.payment_method_id;
        payment.payment_type = paymentDetail.payment_type;
        payment.status = paymentDetail.status;
        payment.transaction_amount = transactionAmount;
        payment.shipping_cost = paymentDetail.shipping_cost;
        payment.marketplace_fee = finalMarketplaceFee;
        payment.iva_amount = ivaAmount;
        payment.total_paid_amount = paymentDetail.total_paid_amount;
        payment.date_approved = new Date(paymentDetail.date_approved);
        payment.currency_id = paymentDetail.currency_id;
      }

      return payment;
    });

    await this.paymentRepository.save(await Promise.all(paymentPromises));
  }

  private async getOrderBillingInfo(order: Order): Promise<any> {
    try {
      const session = await this.sessionRepository.findOne({
        where: { user_id: order.seller.id },
      });

      if (!session) {
        console.log(`[NotificationService] No session found for seller ${order.seller.id}`);
        return null;
      }

      const response: AxiosResponse = await firstValueFrom(
        this.httpService.get(`${this.apiUrl}/orders/${order.id}/billing_info`, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        }),
      );

      return response.data;
    } catch (error) {
      console.error(`[NotificationService] Error fetching billing info for order ${order.id}:`, error.message);
      return null;
    }
  }

  private extractMarketplaceFee(billingInfo: any): number {
    console.log(`[NotificationService] Full billing info:`, JSON.stringify(billingInfo, null, 2));

    if (!billingInfo) {
      return 0;
    }

    if (billingInfo.billing_info?.details) {
      const details = billingInfo.billing_info.details;
      let totalFee = 0;
      for (const detail of details) {
        if (detail.type === 'fee' || detail.type === 'marketplace_fee' ||
            detail.type === 'ml_fee' || detail.type === 'sale_fee') {
          totalFee += Math.abs(detail.amount || 0);
        }
      }
      if (totalFee > 0) return totalFee;
    }

    if (billingInfo.fees) {
      let totalFee = 0;
      for (const fee of billingInfo.fees) {
        totalFee += Math.abs(fee.amount || 0);
      }
      if (totalFee > 0) return totalFee;
    }

    if (billingInfo.sale_fee) {
      return Math.abs(billingInfo.sale_fee);
    }
    if (billingInfo.marketplace_fee) {
      return Math.abs(billingInfo.marketplace_fee);
    }

    if (billingInfo.billing_info?.transactions) {
      let totalFee = 0;
      for (const transaction of billingInfo.billing_info.transactions) {
        if (transaction.type === 'fee' || transaction.type?.includes('fee')) {
          totalFee += Math.abs(transaction.amount || 0);
        }
      }
      if (totalFee > 0) return totalFee;
    }

    return 0;
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
        where: { user_id: order.seller.id },
      });

      if (!session) {
        console.log('No se encontró sesión activa para la orden:', order.seller.id);
        return 'Unknown';
      }

      const accessToken = session.access_token;
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
        updated_at: new Date(),
      });

      this.refreshAttemptCount = 0;
      return this.getOrderDetails(notification);
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

  // === Metodos de consulta para notificaciones ===

  async findRecent(limit: number): Promise<Notification[]> {
    return this.notificationRepository.find({
      where: { processed: true },
      order: { received: 'DESC' },
      take: limit,
    });
  }

  async countUnread(): Promise<number> {
    return this.notificationRepository.count({
      where: { read: false, processed: true },
    });
  }

  async findHistory(
    page: number,
    limit: number,
    fromDate?: string,
    toDate?: string,
  ): Promise<{
    data: Notification[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const qb = this.notificationRepository.createQueryBuilder('n');
    qb.where('n.processed = :processed', { processed: true });

    if (fromDate) {
      qb.andWhere('n.received >= :fromDate', { fromDate: new Date(fromDate) });
    }
    if (toDate) {
      const toDatePlusOne = new Date(toDate);
      toDatePlusOne.setDate(toDatePlusOne.getDate() + 1);
      qb.andWhere('n.received < :toDate', { toDate: toDatePlusOne });
    }

    qb.orderBy('n.received', 'DESC');
    const total = await qb.getCount();
    const totalPages = Math.ceil(total / limit);
    qb.skip((page - 1) * limit).take(limit);
    const data = await qb.getMany();

    return { data, total, page: Number(page), limit: Number(limit), totalPages };
  }

  async markAsRead(id: string): Promise<void> {
    await this.notificationRepository.update(id, {
      read: true,
      read_at: new Date(),
    });
  }

  async markAllAsRead(): Promise<number> {
    const result = await this.notificationRepository.update(
      { read: false },
      { read: true, read_at: new Date() },
    );
    return result.affected || 0;
  }
}
