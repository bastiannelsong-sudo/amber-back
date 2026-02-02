import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MonthlyConfiguration } from './entities/monthly-configuration.entity';
import { Order } from './entities/order.entity';
import { Payment } from './entities/payment.entity';
import { User } from './entities/user.entity';
import { FaztConfigurationService, CurrentRateResult } from './fazt-configuration.service';

/**
 * DTO para crear/actualizar configuracion mensual
 */
export interface UpsertMonthlyConfigDto {
  packaging_cost_per_item?: number;
  notes?: string | null;
  is_closed?: boolean;
}

/**
 * Resumen de configuracion mensual con metricas calculadas
 */
export interface MonthlyConfigSummary {
  id: number | null;
  seller_id: number;
  year_month: string;
  packaging_cost_per_item: number;
  notes: string | null;
  is_closed: boolean;

  // Metricas calculadas del mes
  flex_shipments_count: number;
  flex_orders_count: number;
  total_items_sold: number;
  total_packaging_cost: number;
  total_flex_shipping_cost: number;

  // Perdidas por envio en devoluciones/reembolsos Flex
  refunded_flex_orders_count: number;
  refunded_flex_shipping_loss: number;

  // Info de tarifa Fazt actual para el mes
  fazt_rate_info: CurrentRateResult | null;

  created_at: Date | null;
  updated_at: Date | null;
}

/**
 * Servicio para gestionar configuraciones mensuales de costos
 */
@Injectable()
export class MonthlyConfigurationService {
  private readonly logger = new Logger(MonthlyConfigurationService.name);

  constructor(
    @InjectRepository(MonthlyConfiguration)
    private readonly monthlyConfigRepository: Repository<MonthlyConfiguration>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly faztConfigService: FaztConfigurationService,
  ) {}

  /**
   * Obtener o crear configuracion mensual con metricas calculadas
   */
  async getMonthlyConfig(
    sellerId: number,
    yearMonth: string,
  ): Promise<MonthlyConfigSummary> {
    // Buscar configuracion existente
    let config = await this.monthlyConfigRepository.findOne({
      where: { seller_id: sellerId, year_month: yearMonth },
    });

    // Calcular metricas del mes
    const metrics = await this.calculateMonthlyMetrics(sellerId, yearMonth);

    // Obtener tarifa Fazt para el mes (si existe configuracion)
    let faztRateInfo: CurrentRateResult | null = null;
    try {
      faztRateInfo = await this.faztConfigService.getCurrentRate(sellerId, yearMonth);
    } catch {
      // Si no hay config Fazt, dejamos null
    }

    // Calcular costo total de empaque
    const packagingCostPerItem = config ? Number(config.packaging_cost_per_item) : 0;
    const totalPackagingCost = packagingCostPerItem * metrics.total_items_sold;

    return {
      id: config?.id || null,
      seller_id: sellerId,
      year_month: yearMonth,
      packaging_cost_per_item: packagingCostPerItem,
      notes: config?.notes || null,
      is_closed: config?.is_closed || false,
      flex_shipments_count: metrics.flex_shipments_count,
      flex_orders_count: metrics.flex_orders_count,
      total_items_sold: metrics.total_items_sold,
      total_packaging_cost: totalPackagingCost,
      total_flex_shipping_cost: metrics.total_flex_shipping_cost,
      refunded_flex_orders_count: metrics.refunded_flex_orders_count,
      refunded_flex_shipping_loss: metrics.refunded_flex_shipping_loss,
      fazt_rate_info: faztRateInfo,
      created_at: config?.created_at || null,
      updated_at: config?.updated_at || null,
    };
  }

  /**
   * Crear o actualizar configuracion mensual
   */
  async upsertMonthlyConfig(
    sellerId: number,
    yearMonth: string,
    dto: UpsertMonthlyConfigDto,
  ): Promise<MonthlyConfigSummary> {
    // Verificar que el vendedor existe
    const seller = await this.userRepository.findOne({ where: { id: sellerId } });
    if (!seller) {
      throw new Error(`Vendedor ${sellerId} no encontrado`);
    }

    // Buscar configuracion existente
    let config = await this.monthlyConfigRepository.findOne({
      where: { seller_id: sellerId, year_month: yearMonth },
    });

    if (config) {
      // Actualizar existente
      if (dto.packaging_cost_per_item !== undefined) {
        config.packaging_cost_per_item = dto.packaging_cost_per_item;
      }
      if (dto.notes !== undefined) {
        config.notes = dto.notes;
      }
      if (dto.is_closed !== undefined) {
        config.is_closed = dto.is_closed;
      }
    } else {
      // Crear nueva
      config = this.monthlyConfigRepository.create({
        seller,
        seller_id: sellerId,
        year_month: yearMonth,
        packaging_cost_per_item: dto.packaging_cost_per_item ?? 0,
        notes: dto.notes ?? null,
        is_closed: dto.is_closed ?? false,
      });
    }

    await this.monthlyConfigRepository.save(config);
    this.logger.log(`Configuracion mensual guardada para ${sellerId} en ${yearMonth}`);

    // Retornar con metricas actualizadas
    return this.getMonthlyConfig(sellerId, yearMonth);
  }

  /**
   * Listar meses con configuracion para un vendedor
   */
  async listMonthsWithConfig(sellerId: number): Promise<string[]> {
    const configs = await this.monthlyConfigRepository.find({
      where: { seller_id: sellerId },
      order: { year_month: 'DESC' },
      select: ['year_month'],
    });

    return configs.map((c) => c.year_month);
  }

  /**
   * Listar meses con ordenes para un vendedor
   * Retorna meses que tienen al menos 1 orden, ordenados descendente
   */
  async listMonthsWithOrders(sellerId: number): Promise<string[]> {
    const result = await this.orderRepository
      .createQueryBuilder('o')
      .innerJoin('o.seller', 'seller')
      .select("TO_CHAR(o.date_approved, 'YYYY-MM')", 'year_month')
      .where('seller.id = :sellerId', { sellerId })
      .groupBy("TO_CHAR(o.date_approved, 'YYYY-MM')")
      .orderBy('year_month', 'DESC')
      .getRawMany();

    return result.map((r) => r.year_month);
  }

  /**
   * Calcular metricas del mes desde ordenes en BD
   */
  private async calculateMonthlyMetrics(
    sellerId: number,
    yearMonth: string,
  ): Promise<{
    flex_shipments_count: number;
    flex_orders_count: number;
    total_items_sold: number;
    total_flex_shipping_cost: number;
    refunded_flex_orders_count: number;
    refunded_flex_shipping_loss: number;
  }> {
    const [year, month] = yearMonth.split('-').map(Number);
    // Usar strings para evitar problemas de timezone con TypeORM
    const startDate = `${year}-${String(month).padStart(2, '0')}-01 00:00:00`;
    const lastDay = new Date(year, month, 0).getDate(); // Ultimo dia del mes
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')} 23:59:59`;

    // Contar envios Flex unicos (usando pack_id cuando existe)
    const flexShipmentsResult = await this.orderRepository
      .createQueryBuilder('o')
      .innerJoin('o.seller', 'seller')
      .select('COUNT(DISTINCT COALESCE(o.pack_id::text, o.id::text))', 'unique_shipments')
      .where('seller.id = :sellerId', { sellerId })
      .andWhere('o.date_approved BETWEEN :startDate AND :endDate', { startDate, endDate })
      .andWhere('o.logistic_type IN (:...types)', {
        types: ['self_service', 'self_service_cost'],
      })
      .getRawOne();

    const flexShipmentsCount = parseInt(flexShipmentsResult?.unique_shipments) || 0;

    // Contar ordenes Flex totales
    const flexOrdersResult = await this.orderRepository
      .createQueryBuilder('o')
      .innerJoin('o.seller', 'seller')
      .select('COUNT(*)', 'order_count')
      .where('seller.id = :sellerId', { sellerId })
      .andWhere('o.date_approved BETWEEN :startDate AND :endDate', { startDate, endDate })
      .andWhere('o.logistic_type IN (:...types)', {
        types: ['self_service', 'self_service_cost'],
      })
      .getRawOne();

    const flexOrdersCount = parseInt(flexOrdersResult?.order_count) || 0;

    // Contar total de items vendidos (desde OrderItem, sumando quantity)
    const itemsResult = await this.orderRepository
      .createQueryBuilder('o')
      .innerJoin('o.seller', 'seller')
      .innerJoin('o.items', 'item')
      .select('SUM(item.quantity)', 'total_items')
      .where('seller.id = :sellerId', { sellerId })
      .andWhere('o.date_approved BETWEEN :startDate AND :endDate', { startDate, endDate })
      .getRawOne();

    const totalItemsSold = parseInt(itemsResult?.total_items) || 0;

    // Sumar costo Fazt total de ordenes Flex
    const flexCostQuery = this.paymentRepository
      .createQueryBuilder('p')
      .innerJoin('p.order', 'o')
      .innerJoin('o.seller', 'seller')
      .select('SUM(p.fazt_cost)', 'total_fazt_cost')
      .where('seller.id = :sellerId', { sellerId })
      .andWhere('o.date_approved BETWEEN :startDate AND :endDate', { startDate, endDate })
      .andWhere('o.logistic_type IN (:...types)', {
        types: ['self_service', 'self_service_cost'],
      });

    const flexCostResult = await flexCostQuery.getRawOne();

    const totalFlexShippingCost = parseFloat(flexCostResult?.total_fazt_cost) || 0;

    // Calcular perdidas por envio en ordenes Flex reembolsadas/devueltas
    // Estas son ordenes que fueron enviadas (pagaste Fazt) pero luego fueron canceladas/reembolsadas
    const refundedFlexQuery = this.paymentRepository
      .createQueryBuilder('p')
      .innerJoin('p.order', 'o')
      .innerJoin('o.seller', 'seller')
      .select('COUNT(DISTINCT o.id)', 'refunded_count')
      .addSelect('SUM(p.fazt_cost)', 'refunded_fazt_cost')
      .where('seller.id = :sellerId', { sellerId })
      .andWhere('o.date_approved BETWEEN :startDate AND :endDate', { startDate, endDate })
      .andWhere('o.logistic_type IN (:...types)', {
        types: ['self_service', 'self_service_cost'],
      })
      // Ordenes reembolsadas: payment.status = 'refunded' OR order.status = 'cancelled'
      .andWhere('(p.status = :refundedStatus OR o.status = :cancelledStatus)', {
        refundedStatus: 'refunded',
        cancelledStatus: 'cancelled',
      });

    const refundedFlexResult = await refundedFlexQuery.getRawOne();

    const refundedFlexOrdersCount = parseInt(refundedFlexResult?.refunded_count) || 0;
    const refundedFlexShippingLoss = parseFloat(refundedFlexResult?.refunded_fazt_cost) || 0;

    return {
      flex_shipments_count: flexShipmentsCount,
      flex_orders_count: flexOrdersCount,
      total_items_sold: totalItemsSold,
      total_flex_shipping_cost: totalFlexShippingCost,
      refunded_flex_orders_count: refundedFlexOrdersCount,
      refunded_flex_shipping_loss: refundedFlexShippingLoss,
    };
  }
}
