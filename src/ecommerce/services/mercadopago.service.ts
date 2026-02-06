import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';
import { EcommerceOrder } from '../entities/ecommerce-order.entity';
import { CreateOrderDto } from '../dto/create-order.dto';
import { CouponsService } from './coupons.service';

@Injectable()
export class MercadoPagoService {
  private client: MercadoPagoConfig;

  constructor(
    @InjectRepository(EcommerceOrder)
    private orderRepository: Repository<EcommerceOrder>,
    private configService: ConfigService,
    private couponsService: CouponsService,
  ) {
    this.client = new MercadoPagoConfig({
      accessToken: this.configService.get<string>('MP_ACCESS_TOKEN'),
    });
  }

  /**
   * Create order and MercadoPago preference
   */
  async createOrder(dto: CreateOrderDto): Promise<{
    order: EcommerceOrder;
    init_point: string;
  }> {
    // Calculate totals
    const subtotal = dto.items.reduce(
      (sum, item) => sum + item.unit_price * item.quantity,
      0,
    );

    const shippingCost = subtotal > 50000 ? 0 : 5000;
    let discountAmount = 0;

    // Apply coupon if provided
    if (dto.coupon_code) {
      const couponResult = await this.couponsService.validate(
        dto.coupon_code,
        subtotal,
      );
      if (couponResult.valid) {
        discountAmount = couponResult.discount_amount;
      }
    }

    const total = subtotal + shippingCost - discountAmount;

    // Generate order number
    const orderNumber = `AMB${Date.now().toString(36).toUpperCase()}`;

    // Save order
    const order = this.orderRepository.create({
      order_number: orderNumber,
      customer_email: dto.customer_email,
      customer_name: dto.customer_name,
      customer_phone: dto.customer_phone,
      shipping_address: dto.shipping_address,
      shipping_city: dto.shipping_city,
      shipping_region: dto.shipping_region,
      shipping_postal_code: dto.shipping_postal_code,
      items: dto.items,
      subtotal,
      shipping_cost: shippingCost,
      discount_amount: discountAmount,
      coupon_code: dto.coupon_code || null,
      total,
      status: 'pending',
    });

    const savedOrder = await this.orderRepository.save(order);

    // Create MercadoPago preference
    const preference = new Preference(this.client);

    const preferenceData = await preference.create({
      body: {
        items: dto.items.map((item) => ({
          id: String(item.product_id),
          title: item.name,
          quantity: item.quantity,
          unit_price: item.unit_price,
          currency_id: 'CLP',
        })),
        payer: {
          email: dto.customer_email,
          name: dto.customer_name,
        },
        back_urls: {
          success: `${this.configService.get('ECOMMERCE_URL')}/checkout/resultado?status=success&order=${orderNumber}`,
          failure: `${this.configService.get('ECOMMERCE_URL')}/checkout/resultado?status=failure&order=${orderNumber}`,
          pending: `${this.configService.get('ECOMMERCE_URL')}/checkout/resultado?status=pending&order=${orderNumber}`,
        },
        auto_return: 'approved',
        external_reference: orderNumber,
        notification_url: `${this.configService.get('API_URL')}/ecommerce/payments/webhook`,
        statement_descriptor: 'AMBER JOYERIA',
      },
    });

    // Update order with preference ID
    savedOrder.mp_preference_id = preferenceData.id;
    await this.orderRepository.save(savedOrder);

    // Apply coupon usage if valid
    if (dto.coupon_code && discountAmount > 0) {
      await this.couponsService.incrementUsage(dto.coupon_code);
    }

    return {
      order: savedOrder,
      init_point: preferenceData.init_point,
    };
  }

  /**
   * Handle MercadoPago webhook notification
   */
  async handleWebhook(data: any): Promise<void> {
    if (data.type !== 'payment') return;

    const paymentApi = new Payment(this.client);
    const payment = await paymentApi.get({ id: data.data.id });

    const orderNumber = payment.external_reference;
    const order = await this.orderRepository.findOne({
      where: { order_number: orderNumber },
    });

    if (!order) return;

    order.mp_payment_id = String(payment.id);
    order.mp_payment_status = payment.status;
    order.mp_payment_method = payment.payment_method_id;

    if (payment.status === 'approved') {
      order.status = 'paid';
    } else if (payment.status === 'rejected') {
      order.status = 'cancelled';
    }

    await this.orderRepository.save(order);
  }

  /**
   * Get order by order number
   */
  async getOrderByNumber(orderNumber: string): Promise<EcommerceOrder> {
    const order = await this.orderRepository.findOne({
      where: { order_number: orderNumber },
    });
    if (!order) {
      throw new BadRequestException('Orden no encontrada');
    }
    return order;
  }

  /**
   * Get all ecommerce orders
   */
  async getOrders(page = 1, limit = 20): Promise<{
    orders: EcommerceOrder[];
    total: number;
  }> {
    const [orders, total] = await this.orderRepository.findAndCount({
      order: { created_at: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { orders, total };
  }
}
