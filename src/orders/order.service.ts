import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Order } from './entities/order.entity';
import { User } from './entities/user.entity';
import { OrderItem } from './entities/order-item.entity';
import { Payment } from './entities/payment.entity';
import { ProductAudit } from '../notification/entities/product-audit.entity';
import { PendingSale } from '../notification/entities/pending-sale.entity';
import {
  DailySalesResponseDto,
  OrderSummaryDto,
  LogisticTypeSummaryDto,
  DailySalesSummaryDto,
  SyncOrdersResponseDto,
  SyncMonthlyOrdersResponseDto,
  PaginatedDateRangeSalesResponseDto,
  PaginationMetaDto,
  PackGroupDto,
  AuditSummaryResponseDto,
  UnprocessedOrderDto,
  ReprocessResultDto,
  ReprocessAllResultDto,
  DiscountHistoryResponseDto,
  DiscountHistoryDayDto,
  DiscountHistoryDaySummaryDto,
  DiscountHistoryItemDto,
  DiscountHistoryLogisticDataDto,
  DiscountStatus,
  LogisticGroup,
} from './dto/daily-sales.dto';
import { MercadoLibreService } from '../mercadolibre/mercadolibre.service';
import { TaxService } from '../products/services/tax.service';
import { MonthlyFlexCostService } from './monthly-flex-cost.service';
import { FaztConfigurationService } from './fazt-configuration.service';
import { InventoryService } from '../products/services/inventory.service';
import { PendingSalesService } from '../notification/services/pending-sales.service';
import { Product } from '../products/entities/product.entity';
import { Platform } from '../products/entities/platform.entity';

/**
 * Order Service
 * Handles order queries and daily sales calculations
 *
 * Applies:
 * - db-avoid-n-plus-one: Uses eager loading with relations
 * - arch-single-responsibility: Focused on order operations
 */
@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);
  private mlPlatformId: number | null = null;

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(ProductAudit)
    private readonly productAuditRepository: Repository<ProductAudit>,
    @InjectRepository(PendingSale)
    private readonly pendingSaleRepository: Repository<PendingSale>,
    private readonly mercadoLibreService: MercadoLibreService,
    private readonly taxService: TaxService,
    private readonly monthlyFlexCostService: MonthlyFlexCostService,
    private readonly faztConfigurationService: FaztConfigurationService,
    private readonly inventoryService: InventoryService,
    private readonly pendingSalesService: PendingSalesService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Format a Date object as a local time string for PostgreSQL naive timestamp comparison.
   * The DB stores timestamps without timezone (in server's local time),
   * so we need local time strings for correct comparisons.
   */
  private formatLocalTimestamp(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${y}-${m}-${day} ${h}:${min}:${s}.${ms}`;
  }

  /**
   * Get start and end boundaries for a MercadoLibre/SII date using fixed -04:00 timezone.
   *
   * MercadoLibre always uses -04:00 for Chile internally (regardless of DST).
   * The SII (Chilean tax authority) also uses this same date classification.
   * During Chilean summer (UTC-3), orders between midnight and 1 AM local time
   * belong to the PREVIOUS day in ML/SII's -04:00 timezone.
   *
   * Returns boundaries as local time strings for PostgreSQL naive timestamp queries.
   *
   * Example during summer (server at UTC-3):
   *   getMLDateBoundaries('2026-01-02') → {
   *     start: '2026-01-02 01:00:00.000',  // 00:00 -04:00 = 01:00 -03:00
   *     end:   '2026-01-03 00:59:59.999'   // 23:59 -04:00 = 00:59+1d -03:00
   *   }
   *
   * Example during winter (server at UTC-4):
   *   getMLDateBoundaries('2026-07-02') → {
   *     start: '2026-07-02 00:00:00.000',  // 00:00 -04:00 = 00:00 -04:00
   *     end:   '2026-07-02 23:59:59.999'   // 23:59 -04:00 = 23:59 -04:00
   *   }
   */
  private getMLDateBoundaries(dateStr: string): { start: string; end: string } {
    const startDate = new Date(`${dateStr}T00:00:00.000-04:00`);
    const endDate = new Date(`${dateStr}T23:59:59.999-04:00`);
    return {
      start: this.formatLocalTimestamp(startDate),
      end: this.formatLocalTimestamp(endDate),
    };
  }

  /**
   * Get start and end boundaries for a local date (no -04:00 offset).
   *
   * Uses the server's local timezone (America/Santiago) directly.
   * Midnight is midnight — no 1-hour shift during summer.
   * This is the "Mercado Libre" / "sin cortes" mode.
   */
  private getLocalDateBoundaries(dateStr: string): { start: string; end: string } {
    const [year, month, day] = dateStr.split('-').map(Number);
    const startDate = new Date(year, month - 1, day, 0, 0, 0, 0);
    const endDate = new Date(year, month - 1, day, 23, 59, 59, 999);
    return {
      start: this.formatLocalTimestamp(startDate),
      end: this.formatLocalTimestamp(endDate),
    };
  }

  /**
   * Get date boundaries based on the selected date mode.
   * - 'sii': ML/SII -04:00 timezone (default)
   * - 'mercado_libre': Local timezone, no offset (midnight = midnight)
   */
  private getDateBoundaries(
    dateStr: string,
    dateMode: 'sii' | 'mercado_libre' = 'sii',
  ): { start: string; end: string } {
    return dateMode === 'mercado_libre'
      ? this.getLocalDateBoundaries(dateStr)
      : this.getMLDateBoundaries(dateStr);
  }

  /**
   * Get all orders with relations
   * Uses eager loading to avoid N+1 queries
   */
  async findAll(): Promise<Order[]> {
    return this.orderRepository.find({
      relations: ['buyer', 'seller', 'items'],
    });
  }

  /**
   * Find orders by date for a specific seller
   * Uses date boundaries based on the selected date mode:
   * - 'sii': ML/SII -04:00 timezone (matches MercadoLibre billing and SII)
   * - 'mercado_libre': Local timezone (midnight = midnight, no offset)
   *
   * @param date - Date in YYYY-MM-DD format
   * @param sellerId - Seller ID from Mercado Libre
   * @param dateMode - Date classification mode ('sii' or 'mercado_libre')
   */
  async findByDate(
    date: string,
    sellerId: number,
    dateMode: 'sii' | 'mercado_libre' = 'sii',
  ): Promise<Order[]> {
    const { start, end } = this.getDateBoundaries(date, dateMode);
    this.logger.debug(`Fetching orders for seller ${sellerId} on ${date} [${dateMode}] (boundaries: ${start} → ${end})`);

    const orders = await this.orderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.buyer', 'buyer')
      .leftJoinAndSelect('order.items', 'items')
      .leftJoinAndSelect('order.payments', 'payments')
      .where('order.sellerId = :sellerId', { sellerId })
      .andWhere('order.date_approved >= :start', { start })
      .andWhere('order.date_approved <= :end', { end })
      .orderBy('order.date_approved', 'DESC')
      .getMany();

    this.logger.debug(`Found ${orders.length} orders for ${date}`);

    return orders;
  }

  /**
   * Find orders by pack_id for a specific seller
   * Used to debug/find orders that are grouped in a pack
   */
  async findByPackId(packId: number, sellerId: number): Promise<Order[]> {
    this.logger.debug(`Fetching orders with pack_id ${packId} for seller ${sellerId}`);

    const orders = await this.orderRepository.find({
      where: {
        seller: { id: sellerId },
        pack_id: packId,
      },
      relations: ['buyer', 'items', 'payments'],
      order: { date_approved: 'DESC' },
    });

    this.logger.debug(`Found ${orders.length} orders with pack_id ${packId}`);
    return orders;
  }

  /**
   * Find orders by date range for a specific seller
   * Aggregates orders from fromDate to toDate (inclusive)
   * Uses date boundaries based on the selected date mode.
   *
   * @param fromDate - Start date in YYYY-MM-DD format
   * @param toDate - End date in YYYY-MM-DD format
   * @param sellerId - Seller ID from Mercado Libre
   * @param dateMode - Date classification mode ('sii' or 'mercado_libre')
   */
  async findByDateRange(
    fromDate: string,
    toDate: string,
    sellerId: number,
    dateMode: 'sii' | 'mercado_libre' = 'sii',
  ): Promise<Order[]> {
    const { start } = this.getDateBoundaries(fromDate, dateMode);
    const { end } = this.getDateBoundaries(toDate, dateMode);
    this.logger.debug(
      `Fetching orders for seller ${sellerId} from ${fromDate} to ${toDate} [${dateMode}] (boundaries: ${start} → ${end})`,
    );

    const orders = await this.orderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.buyer', 'buyer')
      .leftJoinAndSelect('order.items', 'items')
      .leftJoinAndSelect('order.payments', 'payments')
      .where('order.sellerId = :sellerId', { sellerId })
      .andWhere('order.date_approved >= :start', { start })
      .andWhere('order.date_approved <= :end', { end })
      .orderBy('order.date_approved', 'DESC')
      .getMany();

    this.logger.debug(`Found ${orders.length} orders in date range`);
    return orders;
  }

  /**
   * Get daily sales with complete metrics
   * Groups orders by logistic type and calculates financial metrics
   *
   * Now includes external Flex shipping cost (if registered for the month)
   */
  async getDailySales(
    date: string,
    sellerId: number,
    dateMode: 'sii' | 'mercado_libre' = 'sii',
  ): Promise<DailySalesResponseDto> {
    const orders = await this.findByDate(date, sellerId, dateMode);

    this.logger.debug(`Found ${orders.length} orders for ${date}`);

    // Get the year-month for flex cost lookup (YYYY-MM)
    const yearMonth = date.substring(0, 7);

    // Get the flex cost per order for this month (0 if not registered)
    const flexCostPerOrder =
      await this.monthlyFlexCostService.getCostPerOrder(sellerId, yearMonth);

    this.logger.debug(`Flex cost per order for ${yearMonth}: $${flexCostPerOrder}`);

    // Map orders to DTOs once (avoid duplicate processing)
    // Pass flexCostPerOrder so Flex orders include the external shipping cost
    const orderSummaries = orders.map((o) =>
      this.mapToOrderSummary(o, flexCostPerOrder),
    );

    // Classify by logistic type
    // - fulfillment: Full (ML warehouse)
    // - self_service: Flex (seller delivers directly, buyer pays shipping to seller)
    // - self_service_cost: Flex (free shipping >$20k, seller pays courier)
    // - cross_docking, xd_drop_off: Centro de Envío (seller drops at ML point, ML charges for shipping)
    const isFlexType = (type: string) =>
      type === 'self_service' || type === 'self_service_cost';

    // Include ALL orders (including cancelled) in classification
    // Cancelled orders count for SII reporting but are excluded from financial sums
    // The calculateLogisticTypeSummary method handles excluding cancelled orders from sums
    const classified = {
      fulfillment: orderSummaries.filter(
        (o) => o.logistic_type === 'fulfillment',
      ),
      cross_docking: orderSummaries.filter(
        (o) => isFlexType(o.logistic_type),
      ),
      other: orderSummaries.filter(
        (o) =>
          o.logistic_type !== 'fulfillment' &&
          !isFlexType(o.logistic_type),
      ),
    };

    // Calculate metrics per logistic type
    const byLogisticType = {
      fulfillment: this.calculateLogisticTypeSummary(
        classified.fulfillment,
        'fulfillment',
        'Full',
      ),
      cross_docking: this.calculateLogisticTypeSummary(
        classified.cross_docking,
        'cross_docking',
        'Flex',
      ),
      other: this.calculateLogisticTypeSummary(
        classified.other,
        'other',
        'Centro de Envío',
      ),
    };

    // Calculate overall summary
    const summary = this.calculateTotalSummary([
      byLogisticType.fulfillment,
      byLogisticType.cross_docking,
      byLogisticType.other,
    ]);

    return {
      date,
      seller_id: sellerId,
      summary,
      by_logistic_type: byLogisticType,
      orders: classified,
    };
  }

  /**
   * Get sales for a date range with complete metrics
   * Similar to getDailySales but aggregates multiple days
   *
   * @param fromDate - Start date in YYYY-MM-DD format
   * @param toDate - End date in YYYY-MM-DD format
   * @param sellerId - Seller ID from Mercado Libre
   */
  async getDateRangeSales(
    fromDate: string,
    toDate: string,
    sellerId: number,
  ): Promise<{
    from_date: string;
    to_date: string;
    seller_id: number;
    days_count: number;
    summary: DailySalesSummaryDto;
    by_logistic_type: {
      fulfillment: LogisticTypeSummaryDto;
      cross_docking: LogisticTypeSummaryDto;
      other: LogisticTypeSummaryDto;
    };
    orders: {
      fulfillment: OrderSummaryDto[];
      cross_docking: OrderSummaryDto[];
      other: OrderSummaryDto[];
    };
  }> {
    const orders = await this.findByDateRange(fromDate, toDate, sellerId);

    // Calculate days count
    const start = new Date(fromDate);
    const end = new Date(toDate);
    const daysCount =
      Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    this.logger.debug(
      `Processing ${orders.length} orders for ${daysCount} days (${fromDate} to ${toDate})`,
    );

    // Use the year-month of fromDate for flex cost lookup
    // For multi-month ranges, this is a simplification
    const yearMonth = fromDate.substring(0, 7);
    const flexCostPerOrder =
      await this.monthlyFlexCostService.getCostPerOrder(sellerId, yearMonth);

    // Map orders to DTOs
    const orderSummaries = orders.map((o) =>
      this.mapToOrderSummary(o, flexCostPerOrder),
    );

    // Classify by logistic type (same logic as getDailySales)
    const isFlexType = (type: string) =>
      type === 'self_service' || type === 'self_service_cost';

    const classified = {
      fulfillment: orderSummaries.filter(
        (o) => o.logistic_type === 'fulfillment',
      ),
      cross_docking: orderSummaries.filter((o) => isFlexType(o.logistic_type)),
      other: orderSummaries.filter(
        (o) =>
          o.logistic_type !== 'fulfillment' && !isFlexType(o.logistic_type),
      ),
    };

    // Calculate metrics per logistic type
    const byLogisticType = {
      fulfillment: this.calculateLogisticTypeSummary(
        classified.fulfillment,
        'fulfillment',
        'Full',
      ),
      cross_docking: this.calculateLogisticTypeSummary(
        classified.cross_docking,
        'cross_docking',
        'Flex',
      ),
      other: this.calculateLogisticTypeSummary(
        classified.other,
        'other',
        'Centro de Envío',
      ),
    };

    // Calculate overall summary
    const summary = this.calculateTotalSummary([
      byLogisticType.fulfillment,
      byLogisticType.cross_docking,
      byLogisticType.other,
    ]);

    return {
      from_date: fromDate,
      to_date: toDate,
      seller_id: sellerId,
      days_count: daysCount,
      summary,
      by_logistic_type: byLogisticType,
      orders: classified,
    };
  }

  /**
   * Get sales for a date range with pagination
   * Returns a flat list of orders (all types combined) with pagination metadata
   * Summary and by_logistic_type are calculated from ALL orders (not just current page)
   *
   * @param fromDate - Start date in YYYY-MM-DD format
   * @param toDate - End date in YYYY-MM-DD format
   * @param sellerId - Seller ID from Mercado Libre
   * @param page - Page number (1-indexed)
   * @param limit - Number of orders per page
   * @param logisticType - Optional filter by logistic type
   * @param dateMode - Date classification mode ('sii' or 'mercado_libre')
   * @param statusFilter - Optional filter by order status (all, active, cancelled, in_mediation, refunded, inactive)
   */
  async getDateRangeSalesPaginated(
    fromDate: string,
    toDate: string,
    sellerId: number,
    page: number = 1,
    limit: number = 20,
    logisticType?: string,
    dateMode: 'sii' | 'mercado_libre' = 'sii',
    statusFilter: 'all' | 'active' | 'cancelled' | 'in_mediation' | 'refunded' | 'inactive' = 'all',
  ): Promise<PaginatedDateRangeSalesResponseDto> {
    const orders = await this.findByDateRange(fromDate, toDate, sellerId, dateMode);

    // Calculate days count
    const start = new Date(fromDate);
    const end = new Date(toDate);
    const daysCount =
      Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    this.logger.debug(
      `Processing ${orders.length} orders for ${daysCount} days (${fromDate} to ${toDate}) - Page ${page}, Limit ${limit}`,
    );

    // Use the year-month of fromDate for flex cost lookup
    const yearMonth = fromDate.substring(0, 7);
    const flexCostPerOrder =
      await this.monthlyFlexCostService.getCostPerOrder(sellerId, yearMonth);

    // Map ALL orders to DTOs (needed for summary calculation)
    const allOrderSummaries = orders.map((o) =>
      this.mapToOrderSummary(o, flexCostPerOrder),
    );

    // Helper to check if logistic type is Flex
    const isFlexType = (type: string) =>
      type === 'self_service' || type === 'self_service_cost';

    // First apply status filter (affects both summary and table)
    let filteredOrders = allOrderSummaries;
    if (statusFilter && statusFilter !== 'all') {
      switch (statusFilter) {
        case 'active':
          filteredOrders = filteredOrders.filter((o) => !o.is_cancelled);
          break;
        case 'cancelled':
          filteredOrders = filteredOrders.filter((o) => o.cancellation_type === 'cancelled');
          break;
        case 'in_mediation':
          filteredOrders = filteredOrders.filter((o) => o.cancellation_type === 'in_mediation');
          break;
        case 'refunded':
          filteredOrders = filteredOrders.filter((o) => o.cancellation_type === 'refunded');
          break;
        case 'inactive':
          filteredOrders = filteredOrders.filter((o) => o.is_cancelled);
          break;
      }
    }

    // Classify by logistic type (from status-filtered orders)
    const classified = {
      fulfillment: filteredOrders.filter(
        (o) => o.logistic_type === 'fulfillment',
      ),
      cross_docking: filteredOrders.filter((o) => isFlexType(o.logistic_type)),
      other: filteredOrders.filter(
        (o) =>
          o.logistic_type !== 'fulfillment' && !isFlexType(o.logistic_type),
      ),
    };

    // Calculate metrics per logistic type (from status-filtered orders)
    const byLogisticType = {
      fulfillment: this.calculateLogisticTypeSummary(
        classified.fulfillment,
        'fulfillment',
        'Full',
      ),
      cross_docking: this.calculateLogisticTypeSummary(
        classified.cross_docking,
        'cross_docking',
        'Flex',
      ),
      other: this.calculateLogisticTypeSummary(
        classified.other,
        'other',
        'Centro de Envío',
      ),
    };

    // Calculate overall summary (from status-filtered orders)
    const summary = this.calculateTotalSummary([
      byLogisticType.fulfillment,
      byLogisticType.cross_docking,
      byLogisticType.other,
    ]);

    // Then apply logistic type filter for table display
    if (logisticType) {
      if (logisticType === 'fulfillment') {
        filteredOrders = classified.fulfillment;
      } else if (logisticType === 'cross_docking') {
        filteredOrders = classified.cross_docking;
      } else if (logisticType === 'other') {
        filteredOrders = classified.other;
      }
    }

    // Sort by date_approved descending (most recent first)
    filteredOrders.sort((a, b) =>
      new Date(b.date_approved).getTime() - new Date(a.date_approved).getTime()
    );

    // Calculate pagination
    const total = filteredOrders.length;
    const totalPages = Math.ceil(total / limit);
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;

    // Get orders for current page
    const paginatedOrders = filteredOrders.slice(startIndex, endIndex);

    // Group paginated orders by pack_id for proper display
    // This ensures shipping costs are shown at pack level
    const packs = this.groupOrdersByPack(paginatedOrders);

    const pagination: PaginationMetaDto = {
      page,
      limit,
      total,
      total_pages: totalPages,
      has_next: page < totalPages,
      has_prev: page > 1,
    };

    return {
      from_date: fromDate,
      to_date: toDate,
      seller_id: sellerId,
      days_count: daysCount,
      summary,
      by_logistic_type: byLogisticType,
      orders: paginatedOrders,
      packs, // Orders grouped by pack_id for correct shipping display
      pagination,
    };
  }

  /**
   * Get human-readable label for logistic type
   * - fulfillment: Full (ML warehouse)
   * - self_service: Flex (seller delivers directly, buyer pays shipping)
   * - self_service_cost: Flex (free shipping >$20k, seller pays courier)
   * - cross_docking, xd_drop_off: Centro de Envío (seller drops at ML point, ML ships)
   */
  private getLogisticTypeLabel(logisticType: string | null): string {
    switch (logisticType) {
      case 'fulfillment':
        return 'Full';
      case 'self_service':
      case 'self_service_cost':
        return 'Flex';
      default:
        return 'Centro de Envío';
    }
  }

  /**
   * Map Order entity to OrderSummaryDto with financial calculations
   *
   * @param order - Order entity
   * @param flexCostPerOrder - External flex shipping cost per order (net, without IVA)
   */
  private mapToOrderSummary(
    order: Order,
    flexCostPerOrder: number = 0,
  ): OrderSummaryDto {
    // Debug: Log buyer data
    this.logger.debug(
      `Order ${order.id} buyer data: ${JSON.stringify(order.buyer)}`,
    );

    // Check if this is a Flex order with shipping INCOME (seller receives payment)
    // self_service = Flex where buyer pays shipping to seller (seller delivers directly)
    const isFlexWithIncome = order.logistic_type === 'self_service';

    // Check if this is a Flex order with shipping COST (free shipping, seller pays)
    // These are orders >$20k where ML offers free shipping but seller still pays courier
    const isFlexWithCost = order.logistic_type === 'self_service_cost';

    // Combined check for all Flex types (for external flex cost application)
    const isAnyFlexOrder = isFlexWithIncome || isFlexWithCost;

    // Get first payment for fee calculation
    const payment = order.payments?.[0];
    const shippingCost = payment ? Number(payment.shipping_cost) || 0 : 0;
    const marketplaceFee = payment ? Number(payment.marketplace_fee) || 0 : 0;
    const ivaAmount = payment ? Number(payment.iva_amount) || 0 : 0;
    const shippingBonus = payment ? Number(payment.shipping_bonus) || 0 : 0; // Bonificación de ML
    const courierCost = payment ? Number(payment.courier_cost) || 0 : 0; // Costo externo courier
    const faztCost = payment ? Number(payment.fazt_cost) || 0 : 0; // Costo Fazt calculado

    // Debug log for refunded Flex orders
    if (isAnyFlexOrder && (payment?.status === 'refunded' || order.status === 'cancelled')) {
      this.logger.debug(`Order ${order.id} - Flex refunded/cancelled: payment.fazt_cost=${payment?.fazt_cost}, faztCost=${faztCost}, payment exists=${!!payment}`);
    }

    // Determine cancellation type: mediación, devolución, or cancelada
    // Priority: in_mediation > refunded > cancelled (payment status takes precedence)
    let cancellationType: 'cancelled' | 'in_mediation' | 'refunded' | null = null;
    if (payment?.status === 'in_mediation') {
      cancellationType = 'in_mediation';
    } else if (payment?.status === 'refunded') {
      cancellationType = 'refunded';
    } else if (order.status === 'cancelled') {
      cancellationType = 'cancelled';
    }
    const isCancelledOrUnavailable = cancellationType !== null;

    // Use Fazt cost from payment if available, otherwise fallback to flexCostPerOrder (MonthlyFlexCost)
    // This allows both systems to coexist during transition
    const externalFlexCost = isAnyFlexOrder ? (faztCost > 0 ? faztCost : flexCostPerOrder) : 0;

    // For Flex orders with INCOME: shipping_cost is INCOME (buyer pays to seller), NOT a cost
    // For Flex FREE SHIPPING: shipping_cost = $0, courier handled by Fazt (externalFlexCost)
    // For Full/Other: shipping_cost is a COST (paid to ML for logistics)
    const shippingFee = isFlexWithIncome ? 0 : shippingCost;
    // courier_cost (senders[0].cost from ML API) is informational only — ML does NOT charge this
    // for Flex orders since the seller uses their own courier (Fazt). The real cost is externalFlexCost.
    const totalFees = shippingFee + marketplaceFee + ivaAmount + externalFlexCost;

    const grossAmount = Number(order.total_amount) || 0;
    // For Flex with income: shipping_cost is INCOME from buyer (they pay shipping to seller)
    // This income should be added to net profit
    const shippingIncome = isFlexWithIncome ? shippingCost : 0;
    // Net profit = gross - fees + bonus + shipping income (for Flex)
    const netProfit = grossAmount - totalFees + shippingBonus + shippingIncome;
    const profitMargin = grossAmount > 0 ? (netProfit / grossAmount) * 100 : 0;

    return {
      id: order.id,
      date_created: order.date_approved,
      date_approved: order.date_approved,
      status: order.status,
      is_cancelled: isCancelledOrUnavailable, // Cancelled OR in_mediation OR refunded - money not available
      cancellation_type: cancellationType, // Specific reason: 'cancelled', 'in_mediation', 'refunded', or null
      shipment_status: order.shipment_status || null, // Estado del envío para detectar pérdidas en reembolsos post-entrega
      total_amount: grossAmount,
      paid_amount: Number(order.paid_amount) || 0,
      logistic_type: order.logistic_type || 'other',
      logistic_type_label: this.getLogisticTypeLabel(order.logistic_type),
      pack_id: order.pack_id || null,
      items:
        order.items?.map((item) => ({
          item_id: item.item_id,
          title: item.title,
          quantity: item.quantity,
          unit_price: Number(item.unit_price) || 0,
          seller_sku: item.seller_sku || '',
          thumbnail: item.thumbnail || null,
        })) || [],
      shipping_cost: shippingCost,
      courier_cost: courierCost,
      marketplace_fee: marketplaceFee,
      iva_amount: ivaAmount,
      shipping_bonus: shippingBonus,
      flex_shipping_cost: externalFlexCost,
      gross_amount: grossAmount,
      total_fees: totalFees,
      net_profit: netProfit,
      profit_margin: profitMargin,
      buyer: order.buyer
        ? {
            id: Number(order.buyer.id),
            nickname: order.buyer.nickname || '',
            first_name: order.buyer.first_name || '',
            last_name: order.buyer.last_name || '',
            // Datos del destinatario del envío (almacenados en la orden)
            receiver_name: (order as any).receiver_name || undefined,
            receiver_phone: (order as any).receiver_phone || undefined,
            receiver_rut: (order as any).receiver_rut || undefined,
          }
        : undefined,
    };
  }

  /**
   * Group orders by pack_id
   * Orders with the same pack_id are grouped together
   * Orders without pack_id are treated as their own "pack" (single order)
   *
   * Shipping costs are calculated at pack level since ML charges shipping per pack, not per order
   */
  private groupOrdersByPack(orders: OrderSummaryDto[]): PackGroupDto[] {
    // Group orders by pack_id (use order id as key for orders without pack)
    const packMap = new Map<string, OrderSummaryDto[]>();

    for (const order of orders) {
      // Use pack_id if exists, otherwise use order id prefixed with 'single_'
      const key = order.pack_id ? `pack_${order.pack_id}` : `single_${order.id}`;

      if (!packMap.has(key)) {
        packMap.set(key, []);
      }
      packMap.get(key)!.push(order);
    }

    // Convert map to array of PackGroupDto
    const packs: PackGroupDto[] = [];

    for (const [key, packOrders] of packMap) {
      const firstOrder = packOrders[0];
      const packId = key.startsWith('pack_')
        ? Number(key.replace('pack_', ''))
        : null;
      const isMultiOrderPack = packOrders.length > 1 && packId !== null;

      // Aggregate values at pack level
      // IMPORTANT: Shipping values are PER PACK (ML charges once per shipment)
      // For multi-order packs: shipping_cost, shipping_bonus, flex_shipping_cost, courier_cost
      // are the SAME on every order - take from first order only to avoid duplication
      const packTotalAmount = packOrders.reduce((sum, o) => sum + o.gross_amount, 0);
      const packMarketplaceFee = packOrders.reduce((sum, o) => sum + o.marketplace_fee, 0);
      const packIvaAmount = packOrders.reduce((sum, o) => sum + o.iva_amount, 0);

      // Shipping: take ONCE from first order (same value duplicated across all orders in pack)
      const packShippingCost = isMultiOrderPack
        ? firstOrder.shipping_cost
        : packOrders.reduce((sum, o) => sum + o.shipping_cost, 0);
      const packShippingBonus = isMultiOrderPack
        ? firstOrder.shipping_bonus
        : packOrders.reduce((sum, o) => sum + o.shipping_bonus, 0);
      const packFlexShippingCost = isMultiOrderPack
        ? (firstOrder.flex_shipping_cost || 0)
        : packOrders.reduce((sum, o) => sum + (o.flex_shipping_cost || 0), 0);
      const packCourierCost = isMultiOrderPack
        ? (firstOrder.courier_cost || 0)
        : packOrders.reduce((sum, o) => sum + (o.courier_cost || 0), 0);

      // Recalculate net profit at pack level to avoid double-counting shipping
      // For Flex (self_service): shipping_cost is INCOME (buyer pays, seller receives), not a fee
      // For Centro de Envío (cross_docking/xd_drop_off): shipping_cost is a COST (ML charges seller)
      const isFlexWithIncome = firstOrder.logistic_type === 'self_service';
      const shippingFee = isFlexWithIncome ? 0 : packShippingCost;
      const shippingIncome = isFlexWithIncome ? packShippingCost : 0;
      const totalFees = shippingFee + packCourierCost + packMarketplaceFee + packIvaAmount + packFlexShippingCost;
      const packNetProfit = packTotalAmount - totalFees + packShippingBonus + shippingIncome;
      const packProfitMargin = packTotalAmount > 0
        ? (packNetProfit / packTotalAmount) * 100
        : 0;

      // Flatten all items from all orders in pack
      const allItems = packOrders.flatMap((o) => o.items);

      // Check if any order in pack is cancelled/mediation/refunded
      const isCancelled = packOrders.some((o) => o.is_cancelled);
      // Determine pack cancellation type (priority: in_mediation > refunded > cancelled)
      let packCancellationType: 'cancelled' | 'in_mediation' | 'refunded' | null = null;
      if (isCancelled) {
        if (packOrders.some((o) => o.cancellation_type === 'in_mediation')) {
          packCancellationType = 'in_mediation';
        } else if (packOrders.some((o) => o.cancellation_type === 'refunded')) {
          packCancellationType = 'refunded';
        } else {
          packCancellationType = 'cancelled';
        }
      }
      const status = packCancellationType || firstOrder.status;

      packs.push({
        pack_id: packId,
        pack_total_amount: packTotalAmount,
        pack_shipping_cost: packShippingCost,
        pack_marketplace_fee: packMarketplaceFee,
        pack_iva_amount: packIvaAmount,
        pack_shipping_bonus: packShippingBonus,
        pack_flex_shipping_cost: packFlexShippingCost,
        pack_courier_cost: packCourierCost,
        pack_net_profit: packNetProfit,
        pack_profit_margin: packProfitMargin,
        logistic_type: firstOrder.logistic_type,
        logistic_type_label: firstOrder.logistic_type_label,
        date_approved: firstOrder.date_approved,
        status,
        is_cancelled: isCancelled,
        cancellation_type: packCancellationType,
        shipment_status: firstOrder.shipment_status, // Estado del envío (todos en el pack comparten el mismo envío)
        buyer: firstOrder.buyer, // Same buyer for all orders in pack
        orders: packOrders,
        all_items: allItems,
      });
    }

    // Sort by date_approved descending (most recent first)
    packs.sort(
      (a, b) =>
        new Date(b.date_approved).getTime() - new Date(a.date_approved).getTime(),
    );

    return packs;
  }

  /**
   * Calculate summary for a logistic type from pre-mapped DTOs
   * Optimized to work with already-transformed data
   *
   * IMPORTANT: Cancelled orders are excluded from all calculations
   * They are still shown in the table for visibility but don't affect totals
   */
  private calculateLogisticTypeSummary(
    orders: OrderSummaryDto[],
    logisticType: string,
    label: string,
  ): LogisticTypeSummaryDto {
    // Count ALL orders (including cancelled) for SII reporting
    const totalOrders = orders.length;

    // Filter out cancelled/in_mediation/refunded orders for FINANCIAL calculations only
    // These orders are shown in the list but don't affect sums (money not available)
    const inactiveOrders = orders.filter((o) => o.is_cancelled);
    const activeOrders = orders.filter((o) => !o.is_cancelled);
    const activeOrderCount = activeOrders.length;

    // Break down by cancellation type
    const pureCancelled = inactiveOrders.filter((o) => o.cancellation_type === 'cancelled');
    const mediationOrders = inactiveOrders.filter((o) => o.cancellation_type === 'in_mediation');
    const refundedOrders = inactiveOrders.filter((o) => o.cancellation_type === 'refunded');

    const cancelledCount = pureCancelled.length;
    const cancelledAmount = pureCancelled.reduce((sum, o) => sum + o.gross_amount, 0);
    const mediationCount = mediationOrders.length;
    const mediationAmount = mediationOrders.reduce((sum, o) => sum + o.gross_amount, 0);
    const refundedCount = refundedOrders.length;
    const refundedAmount = refundedOrders.reduce((sum, o) => sum + o.gross_amount, 0);

    if (totalOrders === 0) {
      return {
        logistic_type: logisticType,
        logistic_type_label: label,
        total_orders: 0,
        total_items: 0,
        gross_amount: 0,
        shipping_cost: 0,
        marketplace_fee: 0,
        iva_amount: 0,
        shipping_bonus: 0,
        flex_shipping_cost: 0,
        courier_cost: 0,
        total_fees: 0,
        net_profit: 0,
        average_order_value: 0,
        average_profit_margin: 0,
        cancelled_count: 0,
        cancelled_amount: 0,
        mediation_count: 0,
        mediation_amount: 0,
        refunded_count: 0,
        refunded_amount: 0,
      };
    }

    // Single pass aggregation (only active orders for financial metrics)
    // Use order.total_fees which already has correct logic (Flex shipping is not a cost)
    const totals = activeOrders.reduce(
      (acc, order) => ({
        items: acc.items + order.items.reduce((sum, i) => sum + i.quantity, 0),
        gross: acc.gross + order.gross_amount,
        shipping: acc.shipping + order.shipping_cost,
        fee: acc.fee + order.marketplace_fee,
        iva: acc.iva + order.iva_amount,
        bonus: acc.bonus + (order.shipping_bonus || 0),
        flexShipping: acc.flexShipping + (order.flex_shipping_cost || 0),
        courier: acc.courier + (order.courier_cost || 0),
        totalFees: acc.totalFees + order.total_fees, // Pre-calculated, respects Flex logic
        profit: acc.profit + order.net_profit,
        margin: acc.margin + order.profit_margin,
      }),
      { items: 0, gross: 0, shipping: 0, fee: 0, iva: 0, bonus: 0, flexShipping: 0, courier: 0, totalFees: 0, profit: 0, margin: 0 },
    );

    return {
      logistic_type: logisticType,
      logistic_type_label: label,
      total_orders: totalOrders, // Includes cancelled (for SII count)
      total_items: totals.items,
      gross_amount: totals.gross,
      shipping_cost: totals.shipping, // For reference only (Flex = income, not cost)
      marketplace_fee: totals.fee,
      iva_amount: totals.iva,
      shipping_bonus: totals.bonus,
      flex_shipping_cost: totals.flexShipping,
      courier_cost: totals.courier,
      total_fees: totals.totalFees, // Use pre-calculated total that respects Flex logic
      net_profit: totals.profit,
      // Use activeOrderCount for averages (exclude cancelled from average calculations)
      average_order_value: activeOrderCount > 0 ? totals.gross / activeOrderCount : 0,
      average_profit_margin: activeOrderCount > 0 ? totals.margin / activeOrderCount : 0,
      cancelled_count: cancelledCount,
      cancelled_amount: cancelledAmount,
      mediation_count: mediationCount,
      mediation_amount: mediationAmount,
      refunded_count: refundedCount,
      refunded_amount: refundedAmount,
    };
  }

  /**
   * Calculate overall summary from logistic type summaries
   * Uses pre-calculated total_fees which already respects Flex shipping logic
   */
  private calculateTotalSummary(
    summaries: LogisticTypeSummaryDto[],
  ): DailySalesSummaryDto {
    const totals = summaries.reduce(
      (acc, s) => ({
        orders: acc.orders + s.total_orders,
        items: acc.items + s.total_items,
        gross: acc.gross + s.gross_amount,
        shipping: acc.shipping + s.shipping_cost,
        fee: acc.fee + s.marketplace_fee,
        iva: acc.iva + s.iva_amount,
        bonus: acc.bonus + (s.shipping_bonus || 0),
        flexShipping: acc.flexShipping + (s.flex_shipping_cost || 0),
        courier: acc.courier + (s.courier_cost || 0),
        totalFees: acc.totalFees + s.total_fees, // Pre-calculated, respects Flex logic
        profit: acc.profit + s.net_profit,
        cancelledCount: acc.cancelledCount + (s.cancelled_count || 0),
        cancelledAmount: acc.cancelledAmount + (s.cancelled_amount || 0),
        mediationCount: acc.mediationCount + (s.mediation_count || 0),
        mediationAmount: acc.mediationAmount + (s.mediation_amount || 0),
        refundedCount: acc.refundedCount + (s.refunded_count || 0),
        refundedAmount: acc.refundedAmount + (s.refunded_amount || 0),
      }),
      { orders: 0, items: 0, gross: 0, shipping: 0, fee: 0, iva: 0, bonus: 0, flexShipping: 0, courier: 0, totalFees: 0, profit: 0, cancelledCount: 0, cancelledAmount: 0, mediationCount: 0, mediationAmount: 0, refundedCount: 0, refundedAmount: 0 },
    );

    return {
      total_orders: totals.orders,
      total_items: totals.items,
      gross_amount: totals.gross,
      shipping_cost: totals.shipping, // For reference (Flex = income, not cost)
      marketplace_fee: totals.fee,
      iva_amount: totals.iva,
      shipping_bonus: totals.bonus,
      flex_shipping_cost: totals.flexShipping,
      courier_cost: totals.courier,
      total_fees: totals.totalFees, // Use pre-calculated total
      net_profit: totals.profit,
      average_order_value:
        totals.orders > 0 ? totals.gross / totals.orders : 0,
      average_profit_margin:
        totals.gross > 0 ? (totals.profit / totals.gross) * 100 : 0,
      cancelled_count: totals.cancelledCount,
      cancelled_amount: totals.cancelledAmount,
      mediation_count: totals.mediationCount,
      mediation_amount: totals.mediationAmount,
      refunded_count: totals.refundedCount,
      refunded_amount: totals.refundedAmount,
    };
  }

  /**
   * Get audit summary for a specific date — reconciliation report.
   *
   * For each order on this date, checks whether a corresponding stock
   * deduction (product_audit) exists. Orders WITHOUT any audit record
   * were never processed = the deduction was missed.
   *
   * @param date - Date in YYYY-MM-DD format
   * @param sellerId - Seller ID from Mercado Libre
   */
  async getAuditSummary(
    date: string,
    sellerId: number,
  ): Promise<AuditSummaryResponseDto> {
    const { start, end } = this.getMLDateBoundaries(date);

    // Get all orders for this date/seller (id, status, logistic_type, date_approved)
    const orders = await this.orderRepository
      .createQueryBuilder('order')
      .select(['order.id', 'order.status', 'order.logistic_type', 'order.date_approved'])
      .where('order.sellerId = :sellerId', { sellerId })
      .andWhere('order.date_approved >= :start', { start })
      .andWhere('order.date_approved <= :end', { end })
      .getMany();

    const totalOrders = orders.length;

    if (totalOrders === 0) {
      return {
        date,
        seller_id: sellerId,
        total_orders: 0,
        inventory_deducted: 0,
        fulfillment: 0,
        not_found: 0,
        without_audit: 0,
        pending_mapping: 0,
        cancelled: 0,
        tracking_active: true,
      };
    }

    const orderIds = orders.map((o) => o.id);

    // Fulfillment orders (by logistic_type) — ML maneja stock, no requieren descuento local
    const fulfillmentOrders = orders.filter((o) => o.logistic_type === 'fulfillment');

    // Get DISTINCT order_ids that have audits, grouped by their "best" status.
    // An order with multiple items can have multiple audits. We take the
    // most relevant status per order: OK_INTERNO > OK_FULL > CANCELLED > NOT_FOUND
    const auditsPerOrder = await this.productAuditRepository
      .createQueryBuilder('audit')
      .select('audit.order_id', 'order_id')
      .addSelect(`
        CASE
          WHEN MAX(CASE WHEN audit.status = 'OK_INTERNO' THEN 1 ELSE 0 END) = 1 THEN 'OK_INTERNO'
          WHEN MAX(CASE WHEN audit.status = 'OK_FULL' THEN 1 ELSE 0 END) = 1 THEN 'OK_FULL'
          WHEN MAX(CASE WHEN audit.status = 'CANCELLED' THEN 1 ELSE 0 END) = 1 THEN 'CANCELLED'
          ELSE 'NOT_FOUND'
        END
      `, 'best_status')
      .where('audit.order_id IN (:...orderIds)', { orderIds })
      .groupBy('audit.order_id')
      .getRawMany();

    // Build a set of order_ids that have any audit
    const auditedOrderIds = new Set(auditsPerOrder.map((r) => Number(r.order_id)));

    // Count by best_status (from audited orders only)
    const statusCounts: Record<string, number> = {};
    for (const row of auditsPerOrder) {
      const status = row.best_status?.trim() || 'NOT_FOUND';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
    }

    // Fulfillment count = ALL orders with logistic_type fulfillment
    // (regardless of audit status — ML handles their stock)
    const fulfillmentCount = fulfillmentOrders.length;

    // MIN_APPROVED_DATE: determina si esta fecha está dentro del período de seguimiento
    // Usamos comparación de strings YYYY-MM-DD para evitar problemas de timezone
    const minDateStr = (process.env.MIN_APPROVED_DATE || '').substring(0, 10); // '2026-02-02' o ''
    const trackingActive = !minDateStr || date >= minDateStr;

    if (!trackingActive) {
      // Fecha anterior a la activación: solo mostrar datos informativos, sin alertas
      return {
        date,
        seller_id: sellerId,
        total_orders: totalOrders,
        inventory_deducted: statusCounts['OK_INTERNO'] || 0,
        fulfillment: fulfillmentCount,
        not_found: 0,
        without_audit: 0,
        pending_mapping: 0,
        cancelled: statusCounts['CANCELLED'] || 0,
        tracking_active: false,
      };
    }

    // without_audit = orders that are NOT fulfillment AND NOT cancelled AND have NO audit
    const withoutAudit = orders.filter(
      (o) =>
        o.logistic_type !== 'fulfillment' &&
        o.status !== 'cancelled' &&
        !auditedOrderIds.has(o.id),
    ).length;

    // Count pending sales for these order IDs (still pending resolution)
    const orderIdStrings = orderIds.map(String);
    const pendingCount = await this.pendingSaleRepository
      .createQueryBuilder('ps')
      .where('ps.platform_order_id IN (:...orderIds)', { orderIds: orderIdStrings })
      .andWhere('ps.status = :status', { status: 'pending' })
      .getCount();

    return {
      date,
      seller_id: sellerId,
      total_orders: totalOrders,
      inventory_deducted: statusCounts['OK_INTERNO'] || 0,
      fulfillment: fulfillmentCount,
      not_found: statusCounts['NOT_FOUND'] || 0,
      without_audit: withoutAudit,
      pending_mapping: pendingCount,
      cancelled: statusCounts['CANCELLED'] || 0,
      tracking_active: true,
    };
  }

  /**
   * Get Mercado Libre platform ID (cached).
   */
  private async getMlPlatformId(): Promise<number | null> {
    if (this.mlPlatformId !== null) return this.mlPlatformId;
    const platformRepo = this.dataSource.getRepository(Platform);
    const platform = await platformRepo.findOne({
      where: { platform_name: 'Mercado Libre' },
    });
    if (platform) this.mlPlatformId = platform.platform_id;
    return this.mlPlatformId;
  }

  /**
   * Get list of unprocessed orders (sin auditoría) for a date.
   * Excludes fulfillment and cancelled orders.
   */
  async getUnprocessedOrders(
    date: string,
    sellerId: number,
  ): Promise<UnprocessedOrderDto[]> {
    const { start, end } = this.getMLDateBoundaries(date);

    // MIN_APPROVED_DATE: solo retornar órdenes sin procesar desde la fecha de activación
    // Comparación simple de strings YYYY-MM-DD para evitar problemas de timezone
    const minDateStr = (process.env.MIN_APPROVED_DATE || '').substring(0, 10);
    if (minDateStr && date < minDateStr) {
      return [];
    }

    const orders = await this.orderRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.items', 'items')
      .where('order.sellerId = :sellerId', { sellerId })
      .andWhere('order.date_approved >= :start', { start })
      .andWhere('order.date_approved <= :end', { end })
      .andWhere("order.logistic_type != 'fulfillment' OR order.logistic_type IS NULL")
      .andWhere("order.status != 'cancelled'")
      .orderBy('order.date_approved', 'DESC')
      .getMany();

    if (orders.length === 0) return [];

    const orderIds = orders.map((o) => o.id);

    // Find which orders already have audits
    const auditedRows = await this.productAuditRepository
      .createQueryBuilder('audit')
      .select('DISTINCT audit.order_id', 'order_id')
      .where('audit.order_id IN (:...orderIds)', { orderIds })
      .getRawMany();

    const auditedSet = new Set(auditedRows.map((r) => Number(r.order_id)));

    return orders
      .filter((o) => !auditedSet.has(o.id))
      .map((o) => ({
        order_id: o.id,
        date_approved: o.date_approved,
        status: o.status,
        total_amount: Number(o.total_amount),
        logistic_type: o.logistic_type || 'unknown',
        items:
          o.items?.map((i) => ({
            title: i.title,
            seller_sku: i.seller_sku || '',
            quantity: i.quantity,
            unit_price: Number(i.unit_price),
            thumbnail: i.thumbnail || null,
          })) || [],
      }));
  }

  /**
   * Reprocess a single missed order: deduct stock + create audits.
   * Only works if the order has NO existing audits (prevents double-deduction).
   */
  async reprocessOrder(
    orderId: number,
    sellerId: number,
  ): Promise<ReprocessResultDto> {
    const order = await this.orderRepository.findOne({
      where: { id: orderId, sellerId },
      relations: ['items'],
    });

    if (!order) {
      return {
        order_id: orderId,
        status: 'partial',
        message: 'Orden no encontrada',
      };
    }

    // Prevent double-deduction
    const existingAudit = await this.productAuditRepository.findOne({
      where: { order_id: orderId },
    });
    if (existingAudit) {
      return {
        order_id: orderId,
        status: 'already_processed',
        message: 'Esta orden ya fue procesada anteriormente',
      };
    }

    const platformId = await this.getMlPlatformId();
    const results: { sku: string; status: string; message: string }[] = [];

    for (const item of order.items || []) {
      const result = await this.processOrderItemForReprocess(order, item, platformId);
      results.push(result);
    }

    const allOk = results.every(
      (r) => r.status === 'OK_INTERNO' || r.status === 'OK_FULL',
    );

    return {
      order_id: orderId,
      status: allOk ? 'processed' : 'partial',
      message: allOk
        ? 'Orden procesada — stock descontado'
        : 'Algunos items no pudieron ser procesados',
      items: results,
    };
  }

  /**
   * Reprocess ALL unprocessed orders for a date.
   */
  async reprocessAllUnprocessed(
    date: string,
    sellerId: number,
  ): Promise<ReprocessAllResultDto> {
    const unprocessed = await this.getUnprocessedOrders(date, sellerId);
    const details: ReprocessResultDto[] = [];

    for (const order of unprocessed) {
      const result = await this.reprocessOrder(order.order_id, sellerId);
      details.push(result);
    }

    return {
      total: unprocessed.length,
      processed: details.filter((r) => r.status === 'processed').length,
      failed: details.filter((r) => r.status === 'partial').length,
      details,
    };
  }

  /**
   * Process a single order item during reprocessing.
   * Mirrors NotificationService.handleInventoryAndAudit logic.
   */
  private async processOrderItemForReprocess(
    order: Order,
    item: OrderItem,
    platformId: number | null,
  ): Promise<{ sku: string; status: string; message: string }> {
    const sku = item.seller_sku || '';

    // Find product by SKU (same lookup chain as webhook)
    let product: Product | null = null;
    if (platformId && sku) {
      product = await this.inventoryService.findProductBySku(platformId, sku);
    }
    if (!product && platformId && item.item_id) {
      product = await this.inventoryService.findProductBySku(platformId, String(item.item_id));
    }

    // Fallback: direct search by internal_sku
    if (!product) {
      const productRepo = this.dataSource.getRepository(Product);
      product = await productRepo.findOne({
        where: [
          ...(sku ? [{ internal_sku: sku }] : []),
          ...(item.item_id ? [{ internal_sku: String(item.item_id) }] : []),
        ],
      });
    }

    if (!product) {
      // Create pending sale for manual resolution
      if (platformId) {
        try {
          await this.pendingSalesService.create({
            platform_id: platformId,
            platform_order_id: String(order.id),
            platform_sku: sku || String(item.item_id),
            quantity: item.quantity,
            sale_date: order.date_approved,
            raw_data: {
              item_id: item.item_id,
              title: item.title,
              quantity: item.quantity,
              order_id: order.id,
              logistic_type: order.logistic_type,
            },
          });
        } catch {
          // PendingSale may already exist — not critical
        }
      }

      await this.createReprocessAudit(order, sku, item.item_id, 'NOT_FOUND', 0, 'SKU no encontrado en inventario');
      return { sku: sku || item.item_id, status: 'NOT_FOUND', message: 'SKU no encontrado' };
    }

    // Fulfillment — shouldn't happen here since we filter them out, but just in case
    if (order.logistic_type === 'fulfillment') {
      await this.createReprocessAudit(order, sku, item.item_id, 'OK_FULL', item.quantity);
      return { sku, status: 'OK_FULL', message: 'Full — ML maneja stock' };
    }

    // Validate stock availability
    const hasStock = await this.inventoryService.validateStockAvailability(
      product.product_id,
      item.quantity,
    );
    if (!hasStock) {
      await this.createReprocessAudit(
        order, sku, item.item_id, 'NOT_FOUND', 0,
        `Stock insuficiente para descontar ${item.quantity} unidad(es)`,
      );
      return {
        sku,
        status: 'INSUFFICIENT_STOCK',
        message: `Stock insuficiente (necesita ${item.quantity})`,
      };
    }

    // Deduct stock
    const metadata = {
      change_type: 'order' as const,
      changed_by: 'Reproceso manual',
      change_reason: `Reproceso orden ML #${order.id}`,
      platform_id: platformId || undefined,
      platform_order_id: String(order.id),
    };

    try {
      await this.inventoryService.deductStock(product.product_id, item.quantity, metadata);
      await this.createReprocessAudit(order, sku, item.item_id, 'OK_INTERNO', item.quantity);
      return { sku, status: 'OK_INTERNO', message: `Descontado: ${item.quantity} unidad(es)` };
    } catch (error) {
      await this.createReprocessAudit(
        order, sku, item.item_id, 'NOT_FOUND', 0,
        `Error descontando stock: ${error.message}`,
      );
      return { sku, status: 'ERROR', message: error.message };
    }
  }

  /**
   * Create audit record during reprocessing.
   */
  private async createReprocessAudit(
    order: Order,
    sellerSku: string,
    mlSku: string,
    status: 'OK_INTERNO' | 'OK_FULL' | 'NOT_FOUND' | 'CANCELLED',
    quantity: number,
    errorMessage?: string,
  ): Promise<void> {
    const audit = this.productAuditRepository.create({
      order_id: order.id,
      internal_sku: sellerSku,
      secondary_sku: mlSku,
      status,
      quantity_discounted: quantity,
      error_message: errorMessage || null,
      logistic_type: order.logistic_type,
      platform_name: 'Mercado Libre',
    });
    await this.productAuditRepository.save(audit);
  }

  /**
   * Process orders in parallel batches for faster sync
   * @param orders - Array of orders to process
   * @param sellerId - Seller ID
   * @param batchSize - Number of orders to process in parallel (default 15 - balanced for ML rate limits)
   */
  private async processOrdersInBatches(
    orders: any[],
    sellerId: number,
    batchSize = 15,
  ): Promise<number> {
    let syncedCount = 0;

    // Split orders into batches
    for (let i = 0; i < orders.length; i += batchSize) {
      const batch = orders.slice(i, i + batchSize);
      this.logger.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(orders.length / batchSize)} (${batch.length} orders)`);

      // Process batch in parallel
      const results = await Promise.allSettled(
        batch.map((mlOrder) => this.saveOrderFromMercadoLibre(mlOrder, sellerId)),
      );

      // Count successful syncs
      for (const result of results) {
        if (result.status === 'fulfilled') {
          syncedCount++;
        } else {
          this.logger.warn(`Failed to save order: ${result.reason?.message}`);
        }
      }
    }

    return syncedCount;
  }

  async syncFromMercadoLibre(
    date: string,
    sellerId: number,
  ): Promise<SyncOrdersResponseDto> {
    this.logger.log(`Starting sync for seller ${sellerId} on ${date}`);

    try {
      const mlResponse = await this.mercadoLibreService.getOrdersByDate(
        date,
        sellerId,
      );

      // ML API returns { results: [], paging: {} } but service types it as any[]
      const orders = (mlResponse as any)?.results || mlResponse || [];
      this.logger.log(`Received ${orders.length} orders from Mercado Libre`);

      // Process orders in parallel batches (15 at a time - balanced for ML rate limits)
      const syncedCount = await this.processOrdersInBatches(orders, sellerId, 15);

      this.logger.log(`Successfully synced ${syncedCount} orders`);

      // Recalcular costos Fazt para TODO el mes de la fecha sincronizada
      const yearMonth = date.substring(0, 7); // "YYYY-MM" de "YYYY-MM-DD"
      let faztTier = null;
      try {
        faztTier = await this.faztConfigurationService.recalculateMonthlyFaztCosts(
          sellerId,
          yearMonth,
        );
        this.logger.log(`Fazt recálculo: ${faztTier.shipments_count} envíos, ${faztTier.total_updated} pagos actualizados`);
      } catch (error) {
        this.logger.warn(`Fazt recálculo falló (no crítico): ${error.message}`);
      }

      return {
        synced: syncedCount,
        message: `Se sincronizaron ${syncedCount} órdenes correctamente`,
        date,
        seller_id: sellerId,
        fazt_tier: faztTier,
      };
    } catch (error) {
      this.logger.error(`Sync failed: ${error.message}`);

      // Provide user-friendly error messages
      if (error.message?.includes('sesión')) {
        throw new HttpException(
          'No hay sesión activa. Por favor inicia sesión con Mercado Libre.',
          HttpStatus.UNAUTHORIZED,
        );
      }

      if (error.message?.includes('token')) {
        throw new HttpException(
          'Tu sesión ha expirado. Por favor vuelve a iniciar sesión.',
          HttpStatus.UNAUTHORIZED,
        );
      }

      throw new HttpException(
        `Error al sincronizar órdenes: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Save a single order from Mercado Libre API response
   */
  private async saveOrderFromMercadoLibre(
    mlOrder: any,
    sellerId: number,
  ): Promise<void> {
    // Upsert buyer - use upsert to handle existing records
    if (mlOrder.buyer) {
      this.logger.debug(
        `[Sync] Buyer data from ML API: ${JSON.stringify(mlOrder.buyer)}`,
      );
      await this.userRepository.upsert(
        {
          id: mlOrder.buyer.id,
          nickname: mlOrder.buyer.nickname || '',
          first_name: mlOrder.buyer.first_name || '',
          last_name: mlOrder.buyer.last_name || '',
        },
        ['id'],
      );
    }

    // Upsert seller - use upsert to handle existing records
    await this.userRepository.upsert(
      {
        id: sellerId,
        nickname: mlOrder.seller?.nickname || '',
        first_name: mlOrder.seller?.first_name || '',
        last_name: mlOrder.seller?.last_name || '',
      },
      ['id'],
    );

    // Get logistic type and shipping cost from shipment API (search endpoint doesn't include complete data)
    let logisticType = mlOrder.shipping?.logistic_type || null;
    let shipmentCost = 0; // Cost charged by ML for shipping (for xd_drop_off orders)
    let flexShippingIncome = 0; // Shipping income for Flex orders (gross_amount = full amount before buyer discounts)
    let shippingBonus = 0; // Bonificación por envío que ML da al vendedor (para envíos gratis >$20k)
    let courierCost = 0; // Costo externo del courier (para envíos gratis >$20k) - separado de shipping_cost
    // Datos del destinatario (receiver) del envío
    let receiverName: string | null = null;
    let receiverPhone: string | null = null;
    let receiverRut: string | null = null;
    console.log(`[Sync] Order ${mlOrder.id}: initial logistic_type=${logisticType}, shipping_id=${mlOrder.shipping?.id}`);
    let fullOrderDetails: any = null; // Pre-fetch for payments section
    let shipmentData: any = null;
    let shipmentCostsData: any = null;
    let receiverCost = 0;
    let senderCost = 0;

    // Fetch shipment data if we have a shipping_id
    if (mlOrder.shipping?.id) {
      console.log(`[Sync] Fetching shipment for order ${mlOrder.id}...`);

      // PARALLEL ROUND 1: Fetch independent data simultaneously (~2.5x faster)
      const [shipmentResult, billingResult, detailsResult] = await Promise.allSettled([
        this.mercadoLibreService.getOrderShipment(mlOrder.id, sellerId),
        this.mercadoLibreService.getOrderBillingInfo(mlOrder.id, sellerId),
        this.mercadoLibreService.getOrderDetails(mlOrder.id, sellerId),
      ]);

      shipmentData = shipmentResult.status === 'fulfilled' ? shipmentResult.value : null;
      const billingInfo = billingResult.status === 'fulfilled' ? billingResult.value : null;
      fullOrderDetails = detailsResult.status === 'fulfilled' ? detailsResult.value : null;

      // FALLBACK: For cancelled orders, getOrderShipment may return null
      // In that case, try getShipmentById directly with the shipping_id
      if (!shipmentData && mlOrder.shipping?.id) {
        console.log(`[Sync] getOrderShipment returned null, trying getShipmentById for ${mlOrder.shipping.id}...`);
        shipmentData = await this.mercadoLibreService.getShipmentById(mlOrder.shipping.id, sellerId);
      }

      // Log full shipment response to find where cost is stored
      console.log(`[Sync] FULL Shipment response for ${mlOrder.id}:`, JSON.stringify(shipmentData, null, 2));

      if (shipmentData?.logistic_type) {
        logisticType = shipmentData.logistic_type;
        console.log(`[Sync] Got logistic_type from shipment API: ${logisticType}`);
      }

      // Extraer datos del destinatario (receiver) del envío
      if (shipmentData?.receiver_address) {
        receiverName = shipmentData.receiver_address.receiver_name || null;
        receiverPhone = shipmentData.receiver_address.receiver_phone || null;
        if (shipmentData.receiver_address.identification?.number) {
          receiverRut = shipmentData.receiver_address.identification.number;
        }
      }

      // Fallback: use billing info for RUT if shipment didn't have it
      if (!receiverRut && billingInfo?.billing_info?.doc_type === 'RUT' && billingInfo?.billing_info?.doc_number) {
        receiverRut = billingInfo.billing_info.doc_number;
      }
      console.log(`[Sync] Receiver data: name=${receiverName}, phone=${receiverPhone}, rut=${receiverRut}`);

      // ROUND 2: Fetch shipment costs (depends on shipment ID from round 1)
      const shipmentId = shipmentData?.id || mlOrder.shipping?.id;
      shipmentCostsData = await this.mercadoLibreService.getShipmentCosts(shipmentId, sellerId);
      console.log(`[Sync] Shipment costs response:`, JSON.stringify(shipmentCostsData, null, 2));

      // Get receiver (buyer) and sender (seller) costs from shipment_costs API
      receiverCost = Number(shipmentCostsData?.receiver?.cost) || 0;
      senderCost = Number(shipmentCostsData?.senders?.[0]?.cost) || 0;
      console.log(`[Sync] Receiver cost: ${receiverCost}, Sender cost: ${senderCost}`);

      // For Flex self_service orders: seller delivers directly
      // EDGE CASE: Orders >$20k with free shipping - buyer pays $0, seller PAYS courier cost
      if (logisticType === 'self_service') {
        if (receiverCost === 0 && senderCost > 0) {
          // Free shipping for buyer, seller PAYS courier separately
          logisticType = 'self_service_cost';
          shipmentCost = 0; // Envío de ML es $0
          courierCost = senderCost; // Costo externo del courier

          // Extract shipping bonus from sender's discounts (ML gives this to offset part of seller's cost)
          const senderDiscounts = shipmentCostsData?.senders?.[0]?.discounts || [];
          for (const discount of senderDiscounts) {
            if (discount.promoted_amount) {
              shippingBonus += Number(discount.promoted_amount) || 0;
            }
          }
          console.log(`[Sync] FLEX FREE SHIPPING: Envío ML=$0, Courier cost=${courierCost}, Bonus=${shippingBonus}`);
        } else if (receiverCost > 0) {
          // Normal Flex: receiverCost is what the buyer ACTUALLY pays for shipping
          // The difference (gross_amount - receiverCost) is ML's loyal discount (subsidy)
          // Separating them allows us to show what the seller keeps after a refund
          flexShippingIncome = receiverCost;

          // Extract receiver's loyal discount as shipping bonus (ML subsidy)
          // This is the amount ML pays on behalf of the buyer (not refunded to ML on cancellation)
          const receiverDiscounts = shipmentCostsData?.receiver?.discounts || [];
          for (const discount of receiverDiscounts) {
            if (discount.promoted_amount) {
              shippingBonus += Number(discount.promoted_amount) || 0;
            }
          }
          console.log(`[Sync] Flex self_service - buyerPays: ${flexShippingIncome}, mlSubsidy(bonus): ${shippingBonus}, gross: ${shipmentCostsData?.gross_amount}`);
        } else if (shipmentCostsData?.gross_amount) {
          // Fallback: use gross_amount if no receiverCost
          flexShippingIncome = Number(shipmentCostsData.gross_amount);
          console.log(`[Sync] Flex self_service - fallback gross_amount: ${flexShippingIncome}`);
        } else {
          // Last resort: try base_cost from shipment data, then cost
          flexShippingIncome = Number(shipmentData?.base_cost) || Number(shipmentData?.cost) || 0;
          console.log(`[Sync] Flex self_service - fallback base_cost/cost: ${flexShippingIncome}`);
        }
        console.log(`[Sync] Buyer discount info: receiver.discounts=${JSON.stringify(shipmentCostsData?.receiver?.discounts)}`);
      }
      // For Centro de Envío (cross_docking, xd_drop_off): ML handles shipping
      // senders[0].cost is ALREADY the NET cost after ML discounts (matches "Envíos" in ML billing)
      // The "save" field shows how much was discounted, "cost" is the final amount seller pays
      // DO NOT subtract discounts — the cost field is already net!
      else if (logisticType === 'cross_docking' || logisticType === 'xd_drop_off') {
        // senderCost is ALREADY net after ML discounts (confirmed by "save" field in API)
        shipmentCost = senderCost;
        // No bonus/courier for Centro de Envío — just the net cost that matches ML billing
        shippingBonus = 0;
        courierCost = 0;

        const senderSave = shipmentCostsData?.senders?.[0]?.save || 0;
        console.log(`[Sync] Centro de Envío (${logisticType}) - seller pays=${shipmentCost} (ML discounted=${senderSave})`);
      }
      // For fulfillment orders (Full): seller pays senders[0].cost (usually $0, ML handles it)
      else if (logisticType === 'fulfillment') {
        shipmentCost = senderCost; // Usually $0 because ML handles fulfillment
        console.log(`[Sync] Full order - seller pays senders[0].cost: ${shipmentCost} (NOT payment.shipping_cost)`);
      }
    }
    console.log(`[Sync] Final: order=${mlOrder.id}, logistic_type=${logisticType}, shipmentCost=${shipmentCost}, flexShippingIncome=${flexShippingIncome}, courierCost=${courierCost}`);

    // Save order - use column names directly for relations (TypeORM upsert doesn't handle relation objects)
    const orderData: any = {
      id: mlOrder.id,
      date_approved: new Date(mlOrder.date_created || mlOrder.date_closed),
      last_updated: new Date(mlOrder.last_updated || new Date()),
      expiration_date: mlOrder.expiration_date
        ? new Date(mlOrder.expiration_date)
        : null,
      date_closed: mlOrder.date_closed ? new Date(mlOrder.date_closed) : null,
      status: mlOrder.status,
      total_amount: mlOrder.total_amount || 0,
      paid_amount: mlOrder.paid_amount || 0,
      currency_id: mlOrder.currency_id || 'CLP',
      sellerId: sellerId, // Use column name directly for upsert
      fulfilled: mlOrder.fulfilled || false,
      tags: mlOrder.tags || [],
      shipping_id: mlOrder.shipping?.id?.toString() || null,
      logistic_type: logisticType,
      pack_id: mlOrder.pack_id || null,
      // Datos del destinatario del envío
      receiver_name: receiverName,
      receiver_phone: receiverPhone,
      receiver_rut: receiverRut,
      // Estado del envío (para detectar pérdidas en reembolsos post-entrega)
      shipment_status: shipmentData?.status || null,
    };

    // Add buyer using column name directly (TypeORM upsert needs column names, not relation objects)
    if (mlOrder.buyer?.id) {
      orderData.buyerId = mlOrder.buyer.id; // Use column name directly
      this.logger.debug(`[Sync] Setting buyerId for order ${mlOrder.id}: ${mlOrder.buyer.id}`);
    }

    // Use upsert to handle both insert and update cases
    // This prevents "duplicate key" errors when order already exists
    await this.orderRepository.upsert(orderData, ['id']);

    // Use the order ID from ML for subsequent operations
    const orderId = mlOrder.id;

    // Upsert order items: delete existing and insert new ones
    // OrderItem uses auto-generated ID, so we need to delete first
    if (mlOrder.order_items?.length) {
      await this.orderItemRepository.delete({ order: { id: orderId } });

      for (const item of mlOrder.order_items) {
        // Try multiple possible thumbnail locations from ML API
        const thumbnail =
          item.item?.thumbnail ||
          item.item?.secure_thumbnail ||
          item.item?.pictures?.[0]?.url ||
          item.item?.pictures?.[0]?.secure_url ||
          null;

        // Log para debug - ver estructura del item
        if (!thumbnail) {
          console.log(
            '[OrderService] Item sin thumbnail:',
            JSON.stringify(item.item, null, 2),
          );
        }

        await this.orderItemRepository.save({
          order: { id: orderId },
          item_id: item.item?.id || '',
          title: item.item?.title || '',
          category_id: item.item?.category_id || '',
          quantity: item.quantity || 1,
          unit_price: item.unit_price || 0,
          full_unit_price: item.full_unit_price || item.unit_price || 0,
          currency_id: item.currency_id || 'CLP',
          condition: item.item?.condition || 'new',
          warranty: item.item?.warranty || '',
          seller_sku: item.item?.seller_sku || null,
          thumbnail: thumbnail,
        });
      }
    }

    // Upsert payments: use upsert to insert or update based on payment ID
    if (mlOrder.payments?.length) {
      // Fetch order details if not already fetched during parallel round 1
      if (!fullOrderDetails) {
        fullOrderDetails = await this.mercadoLibreService.getOrderDetails(orderId, sellerId);
      }

      // Use payments from full order details if available (includes marketplace_fee)
      const paymentsToUse = fullOrderDetails?.payments || mlOrder.payments;

      this.logger.debug(`[Sync] Using payments from: ${fullOrderDetails ? 'individual order API' : 'search results'}`);

      for (const payment of paymentsToUse) {
        // Log the payment to see what we have
        this.logger.debug(`[Sync] Payment for order ${orderId}: marketplace_fee=${payment.marketplace_fee}, shipping_cost=${payment.shipping_cost}`);

        const transactionAmount = payment.transaction_amount || 0;
        // El precio de venta incluye IVA, extraemos el monto del IVA
        const ivaAmount = this.taxService.extractIva(transactionAmount);

        // marketplace_fee should now come directly from the individual order API
        const finalMarketplaceFee = payment.marketplace_fee || 0;

        // Determine shipping cost based on logistic type:
        // - Flex self_service: use gross_amount = full shipping income before buyer discounts
        // - Flex FREE SHIPPING (self_service_cost): shipping_cost = $0, courier_cost = senders[0].cost
        // - Centro de Envío (cross_docking, xd_drop_off): NET seller cost = senderCost - ML discounts
        // - Full (fulfillment): use senders[0].cost from shipment_costs (usually $0)
        let finalShippingCost = payment.shipping_cost || 0;
        let finalCourierCost = courierCost; // Costo externo del courier (solo para Flex envío gratis)

        if (courierCost > 0) {
          // Flex free shipping: Envío de ML = $0, pero hay costo de courier separado
          finalShippingCost = 0;
          console.log(`[Sync] ✅ FLEX FREE SHIPPING: Envío ML=$0, Courier=${courierCost}`);
        } else if (flexShippingIncome > 0) {
          // Normal Flex self_service: seller receives gross_amount as shipping income
          finalShippingCost = flexShippingIncome;
          console.log(`[Sync] Flex income: ${flexShippingIncome}`);
        } else if (logisticType === 'fulfillment') {
          // Full: seller pays senders[0].cost (usually $0)
          finalShippingCost = shipmentCost;
          console.log(`[Sync] Full order - senderCost: ${finalShippingCost}`);
        } else if (logisticType === 'cross_docking' || logisticType === 'xd_drop_off') {
          // Centro de Envío: NET seller cost (matches ML billing "Envíos")
          finalShippingCost = shipmentCost;
          finalCourierCost = 0; // No courier, ML handles it
          console.log(`[Sync] Centro de Envío - NET seller shipping: ${finalShippingCost} (ML billing amount)`);
        } else if (shipmentCost > 0) {
          // Other logistic types
          finalShippingCost = shipmentCost;
          console.log(`[Sync] Other logistic type cost: ${shipmentCost}`);
        }
        // Warn if Flex self_service has $0 shipping - all sources failed
        if (logisticType === 'self_service' && finalShippingCost === 0 && finalCourierCost === 0) {
          console.log(`[Sync] ⚠️ FLEX self_service order ${orderId} has $0 shipping income. Sources: gross_amount=${shipmentCostsData?.gross_amount}, receiverCost=${receiverCost}, base_cost=${shipmentData?.base_cost}, payment.shipping_cost=${payment.shipping_cost}`);
        }
        console.log(`[Sync] 💾 SAVING Payment: shipping_cost=${finalShippingCost}, courier_cost=${finalCourierCost}, shipping_bonus=${shippingBonus}`);
        console.log(`[Sync] Final marketplace_fee for order ${orderId}: ${finalMarketplaceFee}`);

        // Fazt cost se calcula en lote DESPUÉS de guardar todas las órdenes del día
        // (ver recalculateMonthlyFaztCosts en syncFromMercadoLibre).
        // Aquí solo detectamos zona especial para el flag por orden.
        let faztIsSpecialZone = false;
        const isFlexOrder = logisticType?.includes('self_service');

        if (isFlexOrder && shipmentData?.receiver_address?.city?.id) {
          try {
            const faztConfig = await this.faztConfigurationService.getConfiguration(sellerId);
            if (faztConfig) {
              faztIsSpecialZone = faztConfig.special_zone_city_ids?.includes(
                String(shipmentData.receiver_address.city.id),
              ) || false;
            }
          } catch (error) {
            // No crítico, ignorar
          }
        }

        await this.paymentRepository.upsert(
          {
            id: payment.id,
            order: { id: orderId },
            payment_method_id: payment.payment_method_id || '',
            payment_type: payment.payment_type || '',
            status: payment.status || '',
            transaction_amount: transactionAmount,
            shipping_cost: finalShippingCost,
            marketplace_fee: finalMarketplaceFee,
            iva_amount: ivaAmount,
            shipping_bonus: shippingBonus, // Bonificación por envío de ML
            courier_cost: finalCourierCost, // Costo externo del courier (envíos gratis >$20k)
            // fazt_cost: NOT set here — recalculateMonthlyFaztCosts() handles it post-sync.
            // Setting fazt_cost=0 here caused a race condition when multiple days sync in parallel:
            // Day A recalculates → correct costs → Day B's upsert overwrites back to 0.
            fazt_is_special_zone: faztIsSpecialZone, // Si es zona especial
            total_paid_amount: payment.total_paid_amount || 0,
            date_approved: payment.date_approved
              ? new Date(payment.date_approved)
              : new Date(),
            currency_id: payment.currency_id || 'CLP',
          },
          ['id'], // Conflict column - update if this ID exists
        );
      }
    }
  }

  /**
   * Sync all orders from a specific month from Mercado Libre
   * Uses PARALLEL processing for faster sync (5 days at a time)
   * Also recalculates Fazt costs for all Flex orders
   *
   * @param yearMonth - Month in YYYY-MM format
   * @param sellerId - Seller ID from Mercado Libre
   */
  async syncMonthFromMercadoLibre(
    yearMonth: string,
    sellerId: number,
  ): Promise<SyncMonthlyOrdersResponseDto> {
    this.logger.log(`Starting PARALLEL monthly sync for ${yearMonth}, seller ${sellerId}`);

    const [year, month] = yearMonth.split('-').map(Number);

    // Get the number of days in the month
    const daysInMonth = new Date(year, month, 0).getDate();

    // Build list of dates to sync (excluding future dates)
    const currentDate = new Date();
    const datesToSync: string[] = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const checkDate = new Date(dateStr);

      if (checkDate <= currentDate) {
        datesToSync.push(dateStr);
      }
    }

    this.logger.log(`Will sync ${datesToSync.length} days in parallel batches`);

    const details: { date: string; synced: number }[] = [];
    let totalSynced = 0;

    // Process days in parallel batches (5 days at a time to avoid rate limits)
    const PARALLEL_DAYS = 5;

    for (let i = 0; i < datesToSync.length; i += PARALLEL_DAYS) {
      const batch = datesToSync.slice(i, i + PARALLEL_DAYS);
      this.logger.log(`Processing batch ${Math.floor(i / PARALLEL_DAYS) + 1}/${Math.ceil(datesToSync.length / PARALLEL_DAYS)}: ${batch.join(', ')}`);

      // Sync all days in batch in parallel
      const results = await Promise.allSettled(
        batch.map(async (dateStr) => {
          try {
            const result = await this.syncFromMercadoLibre(dateStr, sellerId);
            return { date: dateStr, synced: result.synced };
          } catch (error) {
            this.logger.warn(`Error syncing ${dateStr}: ${error.message}`);
            return { date: dateStr, synced: 0 };
          }
        }),
      );

      // Collect results
      for (const result of results) {
        if (result.status === 'fulfilled') {
          details.push(result.value);
          totalSynced += result.value.synced;
        } else {
          this.logger.warn(`Batch item failed: ${result.reason}`);
        }
      }

      // Small delay between batches to respect rate limits (200ms)
      if (i + PARALLEL_DAYS < datesToSync.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    // Sort details by date
    details.sort((a, b) => a.date.localeCompare(b.date));

    const daysProcessed = details.length;
    this.logger.log(`PARALLEL monthly sync complete: ${totalSynced} orders from ${daysProcessed} days`);

    return {
      total_synced: totalSynced,
      days_processed: daysProcessed,
      message: `Se sincronizaron ${totalSynced} órdenes de ${daysProcessed} días (sync paralelo)`,
      year_month: yearMonth,
      seller_id: sellerId,
      details,
    };
  }

  /**
   * Sync status changes for orders that were UPDATED in a date range
   * This catches cancellations, returns, payment changes, etc.
   * Uses date_last_updated to find orders that changed after creation
   *
   * @param fromDate - Start date YYYY-MM-DD (updates from)
   * @param toDate - End date YYYY-MM-DD (updates to)
   * @param sellerId - Seller ID
   */
  async syncStatusChanges(
    fromDate: string,
    toDate: string,
    sellerId: number,
  ): Promise<{ updated: number; changes: { order_id: number; old_status: string; new_status: string }[] }> {
    this.logger.log(`Syncing status changes from ${fromDate} to ${toDate} for seller ${sellerId}`);

    try {
      // Get orders that were UPDATED (not created) in the date range
      const mlResponse = await this.mercadoLibreService.getOrdersUpdatedInRange(fromDate, toDate, sellerId);
      const orders = (mlResponse as any)?.results || mlResponse || [];

      this.logger.log(`Found ${orders.length} orders updated in date range`);

      const changes: { order_id: number; old_status: string; new_status: string }[] = [];
      let updatedCount = 0;

      for (const mlOrder of orders) {
        // Check if we have this order in our database
        const existingOrder = await this.orderRepository.findOne({
          where: { id: mlOrder.id },
        });

        if (existingOrder) {
          // Check if status changed
          if (existingOrder.status !== mlOrder.status) {
            this.logger.log(`Order ${mlOrder.id}: status changed from ${existingOrder.status} to ${mlOrder.status}`);
            changes.push({
              order_id: mlOrder.id,
              old_status: existingOrder.status,
              new_status: mlOrder.status,
            });
          }

          // Update the order with latest data
          await this.saveOrderFromMercadoLibre(mlOrder, sellerId);
          updatedCount++;
        } else {
          // New order we didn't have - save it
          await this.saveOrderFromMercadoLibre(mlOrder, sellerId);
          updatedCount++;
        }
      }

      this.logger.log(`Sync status changes complete: ${updatedCount} orders updated, ${changes.length} status changes detected`);

      return {
        updated: updatedCount,
        changes,
      };
    } catch (error) {
      this.logger.error(`Error syncing status changes: ${error.message}`);
      throw error;
    }
  }

  /**
   * Sync orders for a date range in parallel
   * More efficient than syncing day by day
   *
   * @param fromDate - Start date YYYY-MM-DD
   * @param toDate - End date YYYY-MM-DD
   * @param sellerId - Seller ID
   */
  async syncDateRangeParallel(
    fromDate: string,
    toDate: string,
    sellerId: number,
  ): Promise<{
    total_synced: number;
    days_processed: number;
    status_changes: number;
    details: { date: string; synced: number }[];
  }> {
    this.logger.log(`Starting PARALLEL date range sync: ${fromDate} to ${toDate}`);

    // Generate list of dates
    const dates: string[] = [];
    const start = new Date(fromDate);
    const end = new Date(toDate);
    const current = new Date(start);

    while (current <= end) {
      const iso = current.toISOString();
      dates.push(iso.split('T')[0] as string);
      current.setDate(current.getDate() + 1);
    }

    this.logger.log(`Will sync ${dates.length} days in parallel`);

    const details: { date: string; synced: number }[] = [];
    let totalSynced = 0;

    // Process in parallel batches (5 days at a time)
    const PARALLEL_DAYS = 5;

    for (let i = 0; i < dates.length; i += PARALLEL_DAYS) {
      const batch = dates.slice(i, i + PARALLEL_DAYS);

      const results = await Promise.allSettled(
        batch.map(async (dateStr) => {
          try {
            const result = await this.syncFromMercadoLibre(dateStr, sellerId);
            return { date: dateStr, synced: result.synced };
          } catch (error) {
            return { date: dateStr, synced: 0 };
          }
        }),
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          details.push(result.value);
          totalSynced += result.value.synced;
        }
      }

      // Small delay between batches
      if (i + PARALLEL_DAYS < dates.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    // ALSO sync status changes to catch orders that were modified after creation
    // This catches cancellations, returns, etc.
    let statusChangesCount = 0;
    try {
      this.logger.log(`Also checking for status changes in date range...`);
      const statusResult = await this.syncStatusChanges(fromDate, toDate, sellerId);
      statusChangesCount = statusResult.changes.length;
      this.logger.log(`Found ${statusChangesCount} status changes`);
    } catch (error) {
      this.logger.warn(`Could not sync status changes: ${error.message}`);
    }

    details.sort((a, b) => a.date.localeCompare(b.date));

    return {
      total_synced: totalSynced,
      days_processed: details.length,
      status_changes: statusChangesCount,
      details,
    };
  }

  // ─── Discount History ──────────────────────────────────────

  async getDiscountHistory(
    fromDate: string,
    toDate: string,
    sellerId: number,
  ): Promise<DiscountHistoryResponseDto> {
    const rangeStart = this.getMLDateBoundaries(fromDate).start;
    const rangeEnd = this.getMLDateBoundaries(toDate).end;

    const rows: Array<{
      audit_id: number;
      order_id: string;
      internal_sku: string | null;
      secondary_sku: string | null;
      logistic_type: string | null;
      quantity_discounted: number;
      error_message: string | null;
      audit_status: string;
      created_at: string;
      audit_date: string;
      pending_status: string | null;
      resolved_by: string | null;
      resolved_at: string | null;
      platform_sku: string | null;
    }> = await this.dataSource.query(
      `SELECT
        pa.audit_id,
        pa.order_id::text AS order_id,
        pa.internal_sku,
        pa.secondary_sku,
        pa.logistic_type,
        pa.quantity_discounted,
        pa.error_message,
        pa.status AS audit_status,
        pa.created_at::text AS created_at,
        DATE(pa.created_at)::text AS audit_date,
        ps.status AS pending_status,
        ps.resolved_by,
        ps.resolved_at::text AS resolved_at,
        ps.platform_sku
      FROM product_audits pa
      JOIN "order" o ON o.id = pa.order_id
      LEFT JOIN pending_sales ps
        ON ps.platform_order_id = pa.order_id::text
        AND ps.platform_sku = pa.secondary_sku
      WHERE o."sellerId" = $1
        AND pa.created_at >= $2
        AND pa.created_at <= $3
        AND (pa.logistic_type IS NULL OR pa.logistic_type != 'fulfillment')
        AND pa.status != 'OK_FULL'
      ORDER BY pa.created_at DESC`,
      [sellerId, rangeStart, rangeEnd],
    );

    // Group by day
    const dayMap = new Map<string, typeof rows>();
    for (const row of rows) {
      const date = row.audit_date;
      if (!dayMap.has(date)) dayMap.set(date, []);
      dayMap.get(date)!.push(row);
    }

    const emptySummary = (): DiscountHistoryDaySummaryDto => ({
      total_items: 0,
      discounted_count: 0,
      pending_count: 0,
      resolved_count: 0,
      ignored_count: 0,
      cancelled_count: 0,
    });

    const emptyLogisticData = (): DiscountHistoryLogisticDataDto => ({
      summary: emptySummary(),
      items: [],
    });

    const mapStatus = (auditStatus: string, pendingStatus: string | null): DiscountStatus => {
      if (auditStatus === 'OK_INTERNO') return 'discounted';
      if (auditStatus === 'CANCELLED') return 'cancelled';
      // NOT_FOUND
      if (pendingStatus === 'mapped') return 'resolved';
      if (pendingStatus === 'ignored') return 'ignored';
      return 'pending';
    };

    const mapLogisticGroup = (logisticType: string | null): LogisticGroup => {
      return (logisticType === 'self_service' || logisticType === 'self_service_cost') ? 'flex' : 'centro_envio';
    };

    const addToSummary = (summary: DiscountHistoryDaySummaryDto, status: DiscountStatus) => {
      summary.total_items++;
      if (status === 'discounted') summary.discounted_count++;
      else if (status === 'pending') summary.pending_count++;
      else if (status === 'resolved') summary.resolved_count++;
      else if (status === 'ignored') summary.ignored_count++;
      else if (status === 'cancelled') summary.cancelled_count++;
    };

    const totals = emptySummary();
    const days: DiscountHistoryDayDto[] = [];

    // Sort dates descending
    const sortedDates = Array.from(dayMap.keys()).sort((a, b) => b.localeCompare(a));

    for (const date of sortedDates) {
      const dayRows = dayMap.get(date)!;
      const daySummary = emptySummary();
      const flex = emptyLogisticData();
      const centroEnvio = emptyLogisticData();

      for (const row of dayRows) {
        const status = mapStatus(row.audit_status, row.pending_status);
        const group = mapLogisticGroup(row.logistic_type);

        const item: DiscountHistoryItemDto = {
          order_id: Number(row.order_id),
          internal_sku: row.internal_sku,
          platform_sku: row.platform_sku || row.secondary_sku,
          quantity: row.quantity_discounted,
          status,
          logistic_group: group,
          error_message: row.error_message,
          resolved_by: row.resolved_by,
          resolved_at: row.resolved_at,
          created_at: row.created_at,
        };

        const target = group === 'flex' ? flex : centroEnvio;
        target.items.push(item);
        addToSummary(target.summary, status);
        addToSummary(daySummary, status);
        addToSummary(totals, status);
      }

      days.push({
        date,
        summary: daySummary,
        by_logistic_group: { flex, centro_envio: centroEnvio },
      });
    }

    return {
      from_date: fromDate,
      to_date: toDate,
      seller_id: sellerId,
      days,
      totals,
    };
  }
}
