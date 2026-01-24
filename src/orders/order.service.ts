import {
  Injectable,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Order } from './entities/order.entity';
import { User } from './entities/user.entity';
import { OrderItem } from './entities/order-item.entity';
import { Payment } from './entities/payment.entity';
import {
  DailySalesResponseDto,
  OrderSummaryDto,
  LogisticTypeSummaryDto,
  DailySalesSummaryDto,
  SyncOrdersResponseDto,
} from './dto/daily-sales.dto';
import { MercadoLibreService } from '../mercadolibre/mercadolibre.service';
import { TaxService } from '../products/services/tax.service';
import { MonthlyFlexCostService } from './monthly-flex-cost.service';

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

  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(OrderItem)
    private readonly orderItemRepository: Repository<OrderItem>,
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly mercadoLibreService: MercadoLibreService,
    private readonly taxService: TaxService,
    private readonly monthlyFlexCostService: MonthlyFlexCostService,
  ) {}

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
   * Optimized query with all needed relations loaded in single query
   *
   * IMPORTANT: Uses -04:00 timezone (MercadoLibre's timezone for Chile)
   * ML reports to SII using this timezone, so we must match it
   *
   * @param date - Date in YYYY-MM-DD format
   * @param sellerId - Seller ID from Mercado Libre
   */
  async findByDate(date: string, sellerId: number): Promise<Order[]> {
    // MercadoLibre uses -04:00 timezone for defining days (not Chile's -03:00)
    // This affects which orders belong to which day for SII reporting
    const startDate = new Date(`${date}T00:00:00.000-04:00`);
    const endDate = new Date(`${date}T23:59:59.999-04:00`);

    this.logger.debug(`Fetching orders for seller ${sellerId} on ${date} (ML timezone -04:00)`);

    // Single query with all relations - avoids N+1
    const orders = await this.orderRepository.find({
      where: {
        seller: { id: sellerId },
        date_approved: Between(startDate, endDate),
      },
      relations: ['buyer', 'items', 'payments'],
      order: { date_approved: 'DESC' },
    });

    // Debug: Log buyer info for each order
    orders.forEach((order) => {
      this.logger.debug(
        `Order ${order.id} has buyer: ${order.buyer ? `ID=${order.buyer.id}, nickname=${order.buyer.nickname}` : 'NULL'}`,
      );
    });

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
  ): Promise<DailySalesResponseDto> {
    const orders = await this.findByDate(date, sellerId);

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
    // - cross_docking, self_service: Flex (seller uses own courier, buyer pays shipping to seller)
    // - cross_docking_cost, self_service_cost: Flex (free shipping >$20k, seller pays shipping)
    // - xd_drop_off: Centro de Envío (seller drops at ML point, ML charges for shipping)
    const isFlexType = (type: string) =>
      type === 'cross_docking' || type === 'self_service' ||
      type === 'cross_docking_cost' || type === 'self_service_cost';

    // Filter out cancelled orders - they shouldn't count in sales metrics
    const activeOrders = orderSummaries.filter((o) => o.status !== 'cancelled');

    const classified = {
      fulfillment: activeOrders.filter(
        (o) => o.logistic_type === 'fulfillment',
      ),
      cross_docking: activeOrders.filter(
        (o) => isFlexType(o.logistic_type),
      ),
      other: activeOrders.filter(
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
   * Get human-readable label for logistic type
   * - fulfillment: Full (ML warehouse)
   * - cross_docking, self_service: Flex (seller uses own courier, buyer pays shipping)
   * - cross_docking_cost, self_service_cost: Flex (free shipping, seller pays)
   * - xd_drop_off, others: Centro de Envío (seller drops at ML point, ML charges)
   */
  private getLogisticTypeLabel(logisticType: string | null): string {
    switch (logisticType) {
      case 'fulfillment':
        return 'Full';
      case 'cross_docking':
      case 'self_service':
      case 'cross_docking_cost':
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
    // cross_docking, self_service = normal Flex where buyer pays shipping to seller
    const isFlexWithIncome = order.logistic_type === 'cross_docking' || order.logistic_type === 'self_service';

    // Check if this is a Flex order with shipping COST (free shipping, seller pays)
    // These are orders >$20k where ML offers free shipping but seller still pays courier
    const isFlexWithCost = order.logistic_type === 'cross_docking_cost' || order.logistic_type === 'self_service_cost';

    // Combined check for all Flex types (for external flex cost application)
    const isAnyFlexOrder = isFlexWithIncome || isFlexWithCost;

    // Get first payment for fee calculation
    const payment = order.payments?.[0];
    const shippingCost = payment ? Number(payment.shipping_cost) || 0 : 0;
    const marketplaceFee = payment ? Number(payment.marketplace_fee) || 0 : 0;
    const ivaAmount = payment ? Number(payment.iva_amount) || 0 : 0;
    const shippingBonus = payment ? Number(payment.shipping_bonus) || 0 : 0; // Bonificación de ML
    const courierCost = payment ? Number(payment.courier_cost) || 0 : 0; // Costo externo courier

    // Add external flex shipping cost to total fees for all Flex orders
    const externalFlexCost = isAnyFlexOrder ? flexCostPerOrder : 0;

    // For Flex orders with INCOME: shipping_cost is INCOME (buyer pays to seller), NOT a cost
    // For Flex FREE SHIPPING: shipping_cost = $0, but courier_cost IS a cost
    // For Full/Other: shipping_cost is a COST (paid to ML for logistics)
    const shippingFee = isFlexWithIncome ? 0 : shippingCost;
    // courier_cost siempre es un costo (solo existe para envíos gratis)
    const totalFees = shippingFee + courierCost + marketplaceFee + ivaAmount + externalFlexCost;

    const grossAmount = Number(order.total_amount) || 0;
    // Net profit = gross - fees + bonus (bonus is income from ML)
    const netProfit = grossAmount - totalFees + shippingBonus;
    const profitMargin = grossAmount > 0 ? (netProfit / grossAmount) * 100 : 0;

    return {
      id: order.id,
      date_created: order.date_approved,
      date_approved: order.date_approved,
      status: order.status,
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
          }
        : undefined,
    };
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
    // Filter out cancelled orders for metric calculations
    const activeOrders = orders.filter((o) => o.status !== 'cancelled');
    const totalOrders = activeOrders.length;

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
        total_fees: 0,
        net_profit: 0,
        average_order_value: 0,
        average_profit_margin: 0,
      };
    }

    // Single pass aggregation (only active orders)
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
        totalFees: acc.totalFees + order.total_fees, // Pre-calculated, respects Flex logic
        profit: acc.profit + order.net_profit,
        margin: acc.margin + order.profit_margin,
      }),
      { items: 0, gross: 0, shipping: 0, fee: 0, iva: 0, bonus: 0, flexShipping: 0, totalFees: 0, profit: 0, margin: 0 },
    );

    return {
      logistic_type: logisticType,
      logistic_type_label: label,
      total_orders: totalOrders,
      total_items: totals.items,
      gross_amount: totals.gross,
      shipping_cost: totals.shipping, // For reference only (Flex = income, not cost)
      marketplace_fee: totals.fee,
      iva_amount: totals.iva,
      shipping_bonus: totals.bonus,
      flex_shipping_cost: totals.flexShipping,
      total_fees: totals.totalFees, // Use pre-calculated total that respects Flex logic
      net_profit: totals.profit,
      average_order_value: totals.gross / totalOrders,
      average_profit_margin: totals.margin / totalOrders,
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
        totalFees: acc.totalFees + s.total_fees, // Pre-calculated, respects Flex logic
        profit: acc.profit + s.net_profit,
      }),
      { orders: 0, items: 0, gross: 0, shipping: 0, fee: 0, iva: 0, bonus: 0, flexShipping: 0, totalFees: 0, profit: 0 },
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
      total_fees: totals.totalFees, // Use pre-calculated total
      net_profit: totals.profit,
      average_order_value:
        totals.orders > 0 ? totals.gross / totals.orders : 0,
      average_profit_margin:
        totals.gross > 0 ? (totals.profit / totals.gross) * 100 : 0,
    };
  }

  /**
   * Sync orders from Mercado Libre API
   * Fetches orders from ML and saves/updates them in the database
   *
   * Applies:
   * - db-use-transactions: Uses transaction for batch inserts
   * - error-handle-async-errors: Proper error handling
   */
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

      let syncedCount = 0;

      for (const mlOrder of orders) {
        try {
          await this.saveOrderFromMercadoLibre(mlOrder, sellerId);
          syncedCount++;
        } catch (error) {
          this.logger.warn(
            `Failed to save order ${mlOrder.id}: ${error.message}`,
          );
        }
      }

      this.logger.log(`Successfully synced ${syncedCount} orders`);

      return {
        synced: syncedCount,
        message: `Se sincronizaron ${syncedCount} órdenes correctamente`,
        date,
        seller_id: sellerId,
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
    console.log(`[Sync] Order ${mlOrder.id}: initial logistic_type=${logisticType}, shipping_id=${mlOrder.shipping?.id}`);

    // Fetch shipment data if we have a shipping_id
    if (mlOrder.shipping?.id) {
      console.log(`[Sync] Fetching shipment for order ${mlOrder.id}...`);
      const shipmentData = await this.mercadoLibreService.getOrderShipment(mlOrder.id, sellerId);

      // Log full shipment response to find where cost is stored
      console.log(`[Sync] FULL Shipment response for ${mlOrder.id}:`, JSON.stringify(shipmentData, null, 2));

      if (shipmentData?.logistic_type) {
        logisticType = shipmentData.logistic_type;
        console.log(`[Sync] Got logistic_type from shipment API: ${logisticType}`);
      }

      // Fetch shipment costs for all order types to get accurate seller costs
      const shipmentCostsData = await this.mercadoLibreService.getShipmentCosts(shipmentData?.id, sellerId);
      console.log(`[Sync] Shipment costs response:`, JSON.stringify(shipmentCostsData, null, 2));

      // Get receiver (buyer) and sender (seller) costs from shipment_costs API
      const receiverCost = Number(shipmentCostsData?.receiver?.cost) || 0;
      const senderCost = Number(shipmentCostsData?.senders?.[0]?.cost) || 0;
      console.log(`[Sync] Receiver cost: ${receiverCost}, Sender cost: ${senderCost}`);

      // For Flex orders (self_service, cross_docking): seller receives the FULL shipping amount
      // EDGE CASE: Orders >$20k with free shipping - buyer pays $0, seller PAYS shipping cost
      if (logisticType === 'self_service' || logisticType === 'cross_docking') {
        if (receiverCost === 0 && senderCost > 0) {
          // EDGE CASE: Free shipping for buyer, seller PAYS courier separately
          // Mark this with a special logistic type so frontend knows
          logisticType = logisticType + '_cost'; // 'self_service_cost' or 'cross_docking_cost'
          // shipping_cost = $0 (receiver.cost = 0, ML no cobra envío)
          // courier_cost = what seller pays to courier (separate from "Envío")
          shipmentCost = 0; // Envío de ML es $0
          courierCost = senderCost; // Costo externo del courier

          // Extract shipping bonus from sender's discounts (ML gives this to offset part of seller's cost)
          // senders[0].discounts[].promoted_amount is the bonus ML gives
          const senderDiscounts = shipmentCostsData?.senders?.[0]?.discounts || [];
          for (const discount of senderDiscounts) {
            if (discount.promoted_amount) {
              shippingBonus += Number(discount.promoted_amount) || 0;
            }
          }
          console.log(`[Sync] FREE SHIPPING: Envío ML=$0, Courier cost=${courierCost}, Bonus=${shippingBonus}, logistic_type=${logisticType}`);
        } else if (shipmentCostsData?.gross_amount) {
          // Normal case: gross_amount is the FULL shipping value before any buyer discounts
          // ML covers the discount, so seller always receives gross_amount
          flexShippingIncome = Number(shipmentCostsData.gross_amount);
          console.log(`[Sync] Flex order - using shipment_costs.gross_amount: ${flexShippingIncome}`);
        } else {
          // Fallback to base_cost if shipment_costs not available
          flexShippingIncome = Number(shipmentData?.base_cost) || 0;
          console.log(`[Sync] Flex order - fallback to base_cost: ${flexShippingIncome}`);
        }
        console.log(`[Sync] Buyer discount info: receiver.discounts=${JSON.stringify(shipmentCostsData?.receiver?.discounts)}`);
      }
      // For fulfillment orders (Full): seller pays senders[0].cost (usually $0, ML handles it)
      else if (logisticType === 'fulfillment') {
        // For Full orders, seller pays senders[0].cost, NOT payment.shipping_cost
        // payment.shipping_cost is what BUYER paid, not what seller pays
        shipmentCost = senderCost; // Usually $0 because ML handles fulfillment
        console.log(`[Sync] Full order - seller pays senders[0].cost: ${shipmentCost} (NOT payment.shipping_cost)`);
      }
      // For xd_drop_off orders (Centro de Envío), ML charges seller for shipping
      else if (logisticType === 'xd_drop_off') {
        // Use shipping_option.list_cost - this is the cost ML charges the seller
        shipmentCost = Number(shipmentData?.shipping_option?.list_cost) || 0;
        console.log(`[Sync] Centro de Envío order - shipping_option.list_cost: ${shipmentCost}`);
      }
    }
    console.log(`[Sync] Final: order=${mlOrder.id}, logistic_type=${logisticType}, shipmentCost=${shipmentCost}, flexShippingIncome=${flexShippingIncome}, courierCost=${courierCost}`);

    // Save order - only include buyer if it exists
    const orderData: any = {
      id: mlOrder.id,
      date_approved: new Date(mlOrder.date_closed || mlOrder.date_created),
      last_updated: new Date(mlOrder.last_updated || new Date()),
      expiration_date: mlOrder.expiration_date
        ? new Date(mlOrder.expiration_date)
        : null,
      date_closed: mlOrder.date_closed ? new Date(mlOrder.date_closed) : null,
      status: mlOrder.status,
      total_amount: mlOrder.total_amount || 0,
      paid_amount: mlOrder.paid_amount || 0,
      currency_id: mlOrder.currency_id || 'CLP',
      seller: { id: sellerId },
      fulfilled: mlOrder.fulfilled || false,
      tags: mlOrder.tags || [],
      shipping_id: mlOrder.shipping?.id?.toString() || null,
      logistic_type: logisticType,
      pack_id: mlOrder.pack_id || null,
    };

    // Only add buyer if we have a valid buyer id
    if (mlOrder.buyer?.id) {
      orderData.buyer = { id: mlOrder.buyer.id };
      this.logger.debug(`[Sync] Setting buyer for order ${mlOrder.id}: ${mlOrder.buyer.id}`);
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
      // The search endpoint doesn't return complete payment info
      // Fetch the individual order to get marketplace_fee
      const fullOrderDetails = await this.mercadoLibreService.getOrderDetails(orderId, sellerId);

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
        // - Flex (self_service, cross_docking): use gross_amount = full shipping income before buyer discounts
        // - Flex FREE SHIPPING (_cost suffix): shipping_cost = $0 (ML no cobra), courier_cost = senders[0].cost
        // - Centro de Envío (xd_drop_off): use shipping_option.list_cost = what ML charges seller
        // - Full (fulfillment): use senders[0].cost from shipment_costs (usually $0, ML handles it)
        let finalShippingCost = payment.shipping_cost || 0;
        let finalCourierCost = courierCost; // Costo externo del courier (solo para envíos gratis)

        if (courierCost > 0) {
          // Free shipping: Envío de ML = $0, pero hay costo de courier separado
          finalShippingCost = 0;
          console.log(`[Sync] ✅ FREE SHIPPING DETECTED: Envío ML=$0, Courier=${courierCost}`);
        } else if (flexShippingIncome > 0) {
          // Normal Flex: seller receives gross_amount as shipping income
          finalShippingCost = flexShippingIncome;
          console.log(`[Sync] Flex income: ${flexShippingIncome}`);
        } else if (logisticType === 'fulfillment') {
          // Full: seller pays senders[0].cost (usually $0), NOT payment.shipping_cost
          // payment.shipping_cost is what BUYER paid to ML
          finalShippingCost = shipmentCost; // shipmentCost was set to senderCost above
          console.log(`[Sync] Full order - using senderCost: ${finalShippingCost} (ignoring payment.shipping_cost=${payment.shipping_cost})`);
        } else if (shipmentCost > 0) {
          // Centro de Envío: seller pays this cost to ML
          finalShippingCost = shipmentCost;
          console.log(`[Sync] Centro de Envío cost: ${shipmentCost}`);
        }
        console.log(`[Sync] 💾 SAVING Payment: shipping_cost=${finalShippingCost}, courier_cost=${finalCourierCost}, shipping_bonus=${shippingBonus}`);
        console.log(`[Sync] Final marketplace_fee for order ${orderId}: ${finalMarketplaceFee}`);

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
}
