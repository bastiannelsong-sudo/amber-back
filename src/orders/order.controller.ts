import {
  Controller,
  Get,
  Post,
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
  SyncMonthlyOrdersQueryDto,
  SyncMonthlyOrdersResponseDto,
  GetDateRangeSalesQueryDto,
  PaginatedDateRangeSalesResponseDto,
  AuditSummaryResponseDto,
  UnprocessedOrderDto,
  ReprocessResultDto,
  ReprocessAllResultDto,
  GetDiscountHistoryQueryDto,
  DiscountHistoryResponseDto,
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
    return this.orderService.getDailySales(query.date, sellerId, query.date_mode || 'sii');
  }

  /**
   * Get sales for a date range with metrics grouped by logistic type
   * GET /orders/sales-range?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD&seller_id=123&page=1&limit=20
   *
   * If from_date equals to_date, behaves like single-day query
   * Maximum range is 31 days to prevent performance issues
   *
   * Supports pagination with page and limit query params
   * - page: Page number (1-indexed, default: 1)
   * - limit: Orders per page (1-100, default: 20)
   * - logistic_type: Optional filter (fulfillment, cross_docking, other)
   */
  @Get('sales-range')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async getDateRangeSales(
    @Query() query: GetDateRangeSalesQueryDto,
  ): Promise<PaginatedDateRangeSalesResponseDto> {
    const sellerId = parseInt(query.seller_id, 10);

    if (!sellerId || sellerId <= 0) {
      throw new BadRequestException(
        'Se requiere un seller_id válido. Por favor inicia sesión.',
      );
    }

    // Validate date range
    const fromDate = new Date(query.from_date);
    const toDate = new Date(query.to_date);
    const daysDiff = Math.ceil(
      (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (daysDiff < 0) {
      throw new BadRequestException(
        'La fecha inicial debe ser anterior o igual a la fecha final',
      );
    }

    if (daysDiff > 31) {
      throw new BadRequestException('El rango máximo es de 31 días');
    }

    return this.orderService.getDateRangeSalesPaginated(
      query.from_date,
      query.to_date,
      sellerId,
      query.page || 1,
      query.limit || 20,
      query.logistic_type,
      query.date_mode || 'sii',
      query.status_filter || 'all',
    );
  }

  /**
   * Get discount history for a date range
   * GET /orders/discount-history?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD&seller_id=123
   *
   * Shows which products were discounted from inventory per day,
   * grouped by logistic type (Flex vs Centro de Envío).
   * Excludes fulfillment orders.
   */
  @Get('discount-history')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async getDiscountHistory(
    @Query() query: GetDiscountHistoryQueryDto,
  ): Promise<DiscountHistoryResponseDto> {
    const sellerId = parseInt(query.seller_id, 10);

    if (!sellerId || sellerId <= 0) {
      throw new BadRequestException(
        'Se requiere un seller_id válido. Por favor inicia sesión.',
      );
    }

    const fromDate = new Date(query.from_date);
    const toDate = new Date(query.to_date);
    const daysDiff = Math.ceil(
      (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (daysDiff < 0) {
      throw new BadRequestException(
        'La fecha inicial debe ser anterior o igual a la fecha final',
      );
    }

    if (daysDiff > 31) {
      throw new BadRequestException('El rango máximo es de 31 días');
    }

    return this.orderService.getDiscountHistory(
      query.from_date,
      query.to_date,
      sellerId,
    );
  }

  /**
   * Sync orders from Mercado Libre API
   * GET /orders/sync?date=YYYY-MM-DD&seller_id=123
   *
   * Fetches orders from ML API and saves them to the database
   * Applies: security-validate-all-input (using ValidationPipe + DTO)
   */
  @Post('sync')
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
   * Get audit summary for a specific date
   * GET /orders/audit-summary?date=YYYY-MM-DD&seller_id=123
   *
   * Returns how many orders had stock deducted, are fulfillment, pending mapping, etc.
   * Useful after sync to see the inventory impact of a day's orders.
   */
  @Get('audit-summary')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async getAuditSummary(
    @Query() query: SyncOrdersQueryDto,
  ): Promise<AuditSummaryResponseDto> {
    const sellerId = parseInt(query.seller_id, 10);

    if (!sellerId || sellerId <= 0) {
      throw new BadRequestException(
        'Se requiere un seller_id válido. Por favor inicia sesión.',
      );
    }

    return this.orderService.getAuditSummary(query.date, sellerId);
  }

  /**
   * Get unprocessed orders (sin auditoría) for a date
   * GET /orders/unprocessed?date=YYYY-MM-DD&seller_id=123
   *
   * Returns orders that have NO audit record (webhook never processed them).
   * Excludes fulfillment and cancelled orders.
   */
  @Get('unprocessed')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async getUnprocessedOrders(
    @Query() query: SyncOrdersQueryDto,
  ): Promise<UnprocessedOrderDto[]> {
    const sellerId = parseInt(query.seller_id, 10);

    if (!sellerId || sellerId <= 0) {
      throw new BadRequestException(
        'Se requiere un seller_id válido. Por favor inicia sesión.',
      );
    }

    return this.orderService.getUnprocessedOrders(query.date, sellerId);
  }

  /**
   * Reprocess a single missed order (deduct stock + create audit)
   * GET /orders/reprocess-order?order_id=123&seller_id=456
   *
   * Only works if the order has NO existing audits (prevents double-deduction).
   */
  @Post('reprocess-order')
  async reprocessOrder(
    @Query('order_id') orderIdStr: string,
    @Query('seller_id') sellerIdStr: string,
  ): Promise<ReprocessResultDto> {
    const orderId = parseInt(orderIdStr, 10);
    const sellerId = parseInt(sellerIdStr, 10);

    if (!orderId || !sellerId) {
      throw new BadRequestException('Se requiere order_id y seller_id');
    }

    return this.orderService.reprocessOrder(orderId, sellerId);
  }

  /**
   * Reprocess ALL unprocessed orders for a date
   * GET /orders/reprocess-all?date=YYYY-MM-DD&seller_id=123
   *
   * Processes all orders without audits (excluding fulfillment/cancelled).
   */
  @Post('reprocess-all')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async reprocessAllOrders(
    @Query() query: SyncOrdersQueryDto,
  ): Promise<ReprocessAllResultDto> {
    const sellerId = parseInt(query.seller_id, 10);

    if (!sellerId || sellerId <= 0) {
      throw new BadRequestException(
        'Se requiere un seller_id válido. Por favor inicia sesión.',
      );
    }

    return this.orderService.reprocessAllUnprocessed(query.date, sellerId);
  }

  /**
   * Sync all orders from a specific month from Mercado Libre API
   * GET /orders/sync-month?year_month=YYYY-MM&seller_id=123
   *
   * Fetches all orders for each day in the month and saves them (PARALLEL - 5 days at a time)
   * Also recalculates Fazt costs for all Flex orders
   */
  @Post('sync-month')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async syncMonthlyOrders(
    @Query() query: SyncMonthlyOrdersQueryDto,
  ): Promise<SyncMonthlyOrdersResponseDto> {
    const sellerId = parseInt(query.seller_id, 10);

    if (!sellerId || sellerId <= 0) {
      throw new BadRequestException(
        'Se requiere un seller_id válido. Por favor inicia sesión.',
      );
    }

    return this.orderService.syncMonthFromMercadoLibre(query.year_month, sellerId);
  }

  /**
   * Sync orders for a date range in PARALLEL
   * GET /orders/sync-range?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD&seller_id=123
   *
   * Syncs multiple days in parallel (5 at a time) for faster performance
   * Maximum range is 31 days
   */
  @Post('sync-range')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async syncDateRange(
    @Query('from_date') fromDate: string,
    @Query('to_date') toDate: string,
    @Query('seller_id') sellerIdStr: string,
  ): Promise<{ total_synced: number; days_processed: number; details: { date: string; synced: number }[] }> {
    const sellerId = parseInt(sellerIdStr, 10);

    if (!sellerId || sellerId <= 0) {
      throw new BadRequestException(
        'Se requiere un seller_id válido. Por favor inicia sesión.',
      );
    }

    if (!fromDate || !toDate) {
      throw new BadRequestException('Se requieren from_date y to_date');
    }

    // Validate date range
    const from = new Date(fromDate);
    const to = new Date(toDate);
    const daysDiff = Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));

    if (daysDiff < 0) {
      throw new BadRequestException('from_date debe ser anterior o igual a to_date');
    }

    if (daysDiff > 31) {
      throw new BadRequestException('El rango máximo es de 31 días');
    }

    return this.orderService.syncDateRangeParallel(fromDate, toDate, sellerId);
  }

  /**
   * Sync status changes for orders that were UPDATED (not created) in a date range
   * GET /orders/sync-status-changes?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD&seller_id=123
   *
   * This catches orders that changed status after creation:
   * - Cancellations
   * - Returns (in_mediation)
   * - Payment status changes
   *
   * Useful to run after the regular sync to catch status changes
   */
  @Post('sync-status-changes')
  async syncStatusChanges(
    @Query('from_date') fromDate: string,
    @Query('to_date') toDate: string,
    @Query('seller_id') sellerIdStr: string,
  ): Promise<{ updated: number; changes: { order_id: number; old_status: string; new_status: string }[] }> {
    const sellerId = parseInt(sellerIdStr, 10);

    if (!sellerId || sellerId <= 0) {
      throw new BadRequestException('Se requiere un seller_id válido');
    }

    if (!fromDate || !toDate) {
      throw new BadRequestException('Se requieren from_date y to_date');
    }

    return this.orderService.syncStatusChanges(fromDate, toDate, sellerId);
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

    // Fetch all available data from ML APIs in parallel
    const [orderDetails, orderShipment, billingInfo] = await Promise.all([
      this.mercadoLibreService.getOrderDetails(orderIdNum, sellerIdNum),
      this.mercadoLibreService.getOrderShipment(orderIdNum, sellerIdNum),
      this.mercadoLibreService.getOrderBillingInfo(orderIdNum, sellerIdNum),
    ]);

    // If we have a shipment_id, fetch shipment details and costs in parallel
    let shipmentDetails = null;
    let shipmentCosts = null;
    const shipmentId = orderDetails?.shipping?.id || orderShipment?.id;

    if (shipmentId) {
      [shipmentDetails, shipmentCosts] = await Promise.all([
        this.mercadoLibreService.getShipmentById(shipmentId, sellerIdNum),
        this.mercadoLibreService.getShipmentCosts(shipmentId, sellerIdNum),
      ]);
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

  /**
   * Debug endpoint to fetch pack information from ML API
   * GET /orders/debug-pack?pack_id=123&seller_id=456
   *
   * MercadoLibre shows "Venta #" which is often a pack_id, not an order_id
   * This helps find the actual order_id(s) contained in a pack
   */
  @Get('debug-pack')
  async debugMlPack(
    @Query('pack_id') packId: string,
    @Query('seller_id') sellerId: string,
  ): Promise<any> {
    const packIdNum = parseInt(packId, 10);
    const sellerIdNum = parseInt(sellerId, 10);

    if (!packIdNum || !sellerIdNum) {
      throw new BadRequestException('Se requiere pack_id y seller_id');
    }

    // Fetch pack info, orders by pack, and local orders in parallel
    const [packInfo, ordersByPack, localOrders] = await Promise.all([
      this.mercadoLibreService.getPackInfo(packIdNum, sellerIdNum),
      this.mercadoLibreService.getOrdersByPackId(packIdNum, sellerIdNum),
      this.orderService.findByPackId(packIdNum, sellerIdNum),
    ]);

    return {
      pack_id: packIdNum,
      seller_id: sellerIdNum,
      pack_info: packInfo,
      orders_by_pack: ordersByPack,
      local_orders: localOrders,
      summary: {
        pack_found: !packInfo?.error,
        orders_in_ml: ordersByPack?.results?.length || 0,
        orders_in_local_db: localOrders?.length || 0,
      },
    };
  }
}
