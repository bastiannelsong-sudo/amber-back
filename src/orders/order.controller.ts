import {
  Controller,
  Get,
  Query,
  UsePipes,
  ValidationPipe,
  BadRequestException,
} from '@nestjs/common';
import { OrderService } from './order.service';
import { MercadoLibreService } from '../mercadolibre/mercadolibre.service';
import { Order } from './entities/order.entity';
import {
  DailySalesResponseDto,
  GetDailySalesQueryDto,
  SyncOrdersQueryDto,
  SyncOrdersResponseDto,
} from './dto/daily-sales.dto';

/**
 * Orders Controller
 * Handles order-related endpoints including daily sales dashboard
 */
@Controller('orders')
export class OrderController {
  constructor(
    private readonly orderService: OrderService,
    private readonly mercadoLibreService: MercadoLibreService,
  ) {}

  /**
   * Get all orders
   * GET /orders
   */
  @Get()
  async getOrders(): Promise<Order[]> {
    return this.orderService.findAll();
  }

  /**
   * Get daily sales with metrics grouped by logistic type
   * GET /orders/daily-sales?date=YYYY-MM-DD&seller_id=123
   *
   * Applies: security-validate-all-input (using ValidationPipe + DTO)
   */
  @Get('daily-sales')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async getDailySales(
    @Query() query: GetDailySalesQueryDto,
  ): Promise<DailySalesResponseDto> {
    const sellerId = parseInt(query.seller_id, 10);
    return this.orderService.getDailySales(query.date, sellerId);
  }

  /**
   * Sync orders from Mercado Libre API
   * GET /orders/sync?date=YYYY-MM-DD&seller_id=123
   *
   * Fetches orders from ML API and saves them to the database
   * Applies: security-validate-all-input (using ValidationPipe + DTO)
   */
  @Get('sync')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async syncOrders(
    @Query() query: SyncOrdersQueryDto,
  ): Promise<SyncOrdersResponseDto> {
    const sellerId = parseInt(query.seller_id, 10);

    if (!sellerId || sellerId <= 0) {
      throw new BadRequestException(
        'Se requiere un seller_id válido. Por favor inicia sesión.',
      );
    }

    return this.orderService.syncFromMercadoLibre(query.date, sellerId);
  }

  /**
   * Debug endpoint to fetch all ML API data for a specific order
   * GET /orders/debug-ml?order_id=123&seller_id=456
   *
   * Returns all data from ML APIs to find shipping cost location
   */
  @Get('debug-ml')
  async debugMlOrder(
    @Query('order_id') orderId: string,
    @Query('seller_id') sellerId: string,
  ): Promise<any> {
    const orderIdNum = parseInt(orderId, 10);
    const sellerIdNum = parseInt(sellerId, 10);

    if (!orderIdNum || !sellerIdNum) {
      throw new BadRequestException('Se requiere order_id y seller_id');
    }

    // Fetch all available data from ML APIs
    const orderDetails = await this.mercadoLibreService.getOrderDetails(orderIdNum, sellerIdNum);
    const orderShipment = await this.mercadoLibreService.getOrderShipment(orderIdNum, sellerIdNum);
    const billingInfo = await this.mercadoLibreService.getOrderBillingInfo(orderIdNum, sellerIdNum);

    // If we have a shipment_id, fetch shipment details and costs
    let shipmentDetails = null;
    let shipmentCosts = null;
    const shipmentId = orderDetails?.shipping?.id || orderShipment?.id;

    if (shipmentId) {
      shipmentDetails = await this.mercadoLibreService.getShipmentById(shipmentId, sellerIdNum);
      shipmentCosts = await this.mercadoLibreService.getShipmentCosts(shipmentId, sellerIdNum);
    }

    return {
      order_id: orderIdNum,
      seller_id: sellerIdNum,
      shipment_id: shipmentId,
      order_details: orderDetails,
      order_shipment: orderShipment,
      billing_info: billingInfo,
      shipment_details: shipmentDetails,
      shipment_costs: shipmentCosts,
    };
  }
}
