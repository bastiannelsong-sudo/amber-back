import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import {
  FaztConfiguration,
  FaztRateTier,
  DEFAULT_FAZT_TIERS,
  DEFAULT_SPECIAL_ZONE_CITY_IDS,
} from './entities/fazt-configuration.entity';
import { Order } from './entities/order.entity';
import { Payment } from './entities/payment.entity';
import { User } from './entities/user.entity';

/**
 * DTO para crear/actualizar configuración de Fazt
 */
export interface CreateFaztConfigDto {
  rate_tiers?: FaztRateTier[];
  special_zone_surcharge?: number;
  xl_package_surcharge?: number;
  default_service_type?: 'same_day_rm' | 'next_day_v_region';
  special_zone_city_ids?: string[];
  is_active?: boolean;
}

/**
 * Resumen de configuración de Fazt
 */
export interface FaztConfigSummary {
  id: number;
  seller_id: number;
  rate_tiers: FaztRateTier[];
  special_zone_surcharge: number;
  xl_package_surcharge: number;
  default_service_type: string;
  special_zone_city_ids: string[];
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * Resultado del cálculo de tarifa actual
 */
export interface CurrentRateResult {
  shipments_count: number;
  current_tier: FaztRateTier | null;
  same_day_rm_rate: number;
  next_day_v_region_rate: number;
  year_month: string;
}

/**
 * Resultado del cálculo de costo de envío
 */
export interface ShipmentCostResult {
  base_cost: number;
  special_zone_surcharge: number;
  xl_surcharge: number;
  subtotal: number; // Costo sin IVA
  iva_amount: number; // 19% IVA
  total_cost: number; // Costo con IVA (lo que realmente se paga)
  is_special_zone: boolean;
  service_type: string;
}

// IVA rate in Chile
const IVA_RATE = 0.19;

/**
 * Servicio para gestionar configuración y cálculos de tarifas de Fazt
 */
@Injectable()
export class FaztConfigurationService {
  private readonly logger = new Logger(FaztConfigurationService.name);

  constructor(
    @InjectRepository(FaztConfiguration)
    private readonly faztConfigRepository: Repository<FaztConfiguration>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /**
   * Obtener configuración de Fazt para un vendedor
   * Si no existe, retorna null
   */
  async getConfiguration(sellerId: number): Promise<FaztConfigSummary | null> {
    const config = await this.faztConfigRepository.findOne({
      where: { seller: { id: sellerId } },
      relations: ['seller'],
    });

    if (!config) {
      return null;
    }

    return this.toSummary(config);
  }

  /**
   * Crear o actualizar configuración de Fazt
   * Si no se proporcionan tarifas, usa las por defecto
   */
  async upsertConfiguration(
    sellerId: number,
    dto: CreateFaztConfigDto,
  ): Promise<FaztConfigSummary> {
    // Verificar que el vendedor existe
    const seller = await this.userRepository.findOne({ where: { id: sellerId } });
    if (!seller) {
      throw new NotFoundException(`Vendedor ${sellerId} no encontrado`);
    }

    // Buscar configuración existente
    let config = await this.faztConfigRepository.findOne({
      where: { seller: { id: sellerId } },
    });

    if (config) {
      // Actualizar existente
      if (dto.rate_tiers !== undefined) config.rate_tiers = dto.rate_tiers;
      if (dto.special_zone_surcharge !== undefined) config.special_zone_surcharge = dto.special_zone_surcharge;
      if (dto.xl_package_surcharge !== undefined) config.xl_package_surcharge = dto.xl_package_surcharge;
      if (dto.default_service_type !== undefined) config.default_service_type = dto.default_service_type;
      if (dto.special_zone_city_ids !== undefined) config.special_zone_city_ids = dto.special_zone_city_ids;
      if (dto.is_active !== undefined) config.is_active = dto.is_active;
    } else {
      // Crear nueva con valores por defecto
      config = this.faztConfigRepository.create({
        seller,
        rate_tiers: dto.rate_tiers || DEFAULT_FAZT_TIERS,
        special_zone_surcharge: dto.special_zone_surcharge ?? 1000,
        xl_package_surcharge: dto.xl_package_surcharge ?? 2000,
        default_service_type: dto.default_service_type || 'same_day_rm',
        special_zone_city_ids: dto.special_zone_city_ids || DEFAULT_SPECIAL_ZONE_CITY_IDS,
        is_active: dto.is_active ?? true,
      });
    }

    const saved = await this.faztConfigRepository.save(config);
    this.logger.log(`Configuración Fazt guardada para vendedor ${sellerId}`);

    return this.toSummary(saved);
  }

  /**
   * Contar envíos Flex únicos del mes
   * - Si tiene pack_id: cuenta como 1 envío por pack_id único
   * - Si no tiene pack_id: cuenta como 1 envío por orden
   */
  async countUniqueFlexShipments(
    sellerId: number,
    yearMonth: string,
  ): Promise<number> {
    const [year, month] = yearMonth.split('-').map(Number);
    const startDate = new Date(year, month - 1, 1, 0, 0, 0);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    this.logger.debug(`Contando envíos Flex únicos para ${sellerId} en ${yearMonth}`);

    // COALESCE(pack_id, id) agrupa por pack_id si existe, sino por order id
    // Use alias 'o' instead of 'order' since 'order' is a reserved keyword in PostgreSQL
    const result = await this.orderRepository
      .createQueryBuilder('o')
      .innerJoin('o.seller', 'seller')
      .select('COUNT(DISTINCT COALESCE(o.pack_id::text, o.id::text))', 'unique_shipments')
      .where('seller.id = :sellerId', { sellerId })
      .andWhere('o.date_approved BETWEEN :startDate AND :endDate', {
        startDate,
        endDate,
      })
      .andWhere('o.logistic_type IN (:...types)', {
        types: ['cross_docking', 'self_service', 'cross_docking_cost', 'self_service_cost'],
      })
      .getRawOne();

    const count = parseInt(result?.unique_shipments) || 0;
    this.logger.debug(`Envíos únicos encontrados: ${count}`);

    return count;
  }

  /**
   * Obtener la tarifa según el volumen de envíos del mes indicado
   * @param sellerId - ID del vendedor
   * @param yearMonth - Mes en formato YYYY-MM (si no se pasa, usa el mes actual)
   */
  async getCurrentRate(sellerId: number, yearMonth?: string): Promise<CurrentRateResult> {
    const config = await this.faztConfigRepository.findOne({
      where: { seller: { id: sellerId }, is_active: true },
    });

    if (!config) {
      throw new NotFoundException(`No hay configuración Fazt activa para vendedor ${sellerId}`);
    }

    // Si no se pasa yearMonth, usar mes actual (comportamiento existente)
    if (!yearMonth) {
      const now = new Date();
      yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    // Contar envíos del mes
    const shipmentsCount = await this.countUniqueFlexShipments(sellerId, yearMonth);

    // Encontrar el tier correspondiente
    const currentTier = this.findTierForVolume(config.rate_tiers, shipmentsCount);

    return {
      shipments_count: shipmentsCount,
      current_tier: currentTier,
      same_day_rm_rate: currentTier?.same_day_rm || 0,
      next_day_v_region_rate: currentTier?.next_day_v_region || 0,
      year_month: yearMonth,
    };
  }

  /**
   * Calcular el costo de un envío específico
   * @param sellerId - ID del vendedor
   * @param serviceType - Tipo de servicio (same_day_rm o next_day_v_region)
   * @param cityId - ID de ciudad del destinatario (para detectar zona especial)
   * @param isXlPackage - Si es un paquete XL (no implementado aún)
   */
  async calculateShipmentCost(
    sellerId: number,
    serviceType?: 'same_day_rm' | 'next_day_v_region',
    cityId?: string,
    isXlPackage: boolean = false,
  ): Promise<ShipmentCostResult> {
    const config = await this.faztConfigRepository.findOne({
      where: { seller: { id: sellerId }, is_active: true },
    });

    if (!config) {
      // Si no hay configuración, retorna 0
      return {
        base_cost: 0,
        special_zone_surcharge: 0,
        xl_surcharge: 0,
        subtotal: 0,
        iva_amount: 0,
        total_cost: 0,
        is_special_zone: false,
        service_type: serviceType || 'same_day_rm',
      };
    }

    // Usar tipo de servicio por defecto si no se especifica
    const effectiveServiceType = serviceType || config.default_service_type;

    // Obtener tarifa actual
    const currentRate = await this.getCurrentRate(sellerId);
    const baseCost =
      effectiveServiceType === 'next_day_v_region'
        ? currentRate.next_day_v_region_rate
        : currentRate.same_day_rm_rate;

    // Verificar si es zona especial
    const isSpecialZone = cityId
      ? config.special_zone_city_ids?.includes(cityId) || false
      : false;

    const specialZoneSurcharge = isSpecialZone
      ? Number(config.special_zone_surcharge)
      : 0;

    // Recargo XL (no implementado aún)
    const xlSurcharge = isXlPackage ? Number(config.xl_package_surcharge) : 0;

    // Subtotal sin IVA
    const subtotal = baseCost + specialZoneSurcharge + xlSurcharge;

    // Calcular IVA (19%)
    const ivaAmount = Math.round(subtotal * IVA_RATE);

    // Total con IVA (lo que realmente se paga a Fazt)
    const totalCost = subtotal + ivaAmount;

    return {
      base_cost: baseCost,
      special_zone_surcharge: specialZoneSurcharge,
      xl_surcharge: xlSurcharge,
      subtotal,
      iva_amount: ivaAmount,
      total_cost: totalCost,
      is_special_zone: isSpecialZone,
      service_type: effectiveServiceType,
    };
  }

  /**
   * Recalcular fazt_cost para TODAS las órdenes Flex de un mes.
   * Se llama DESPUÉS de sincronizar las órdenes del día, para que el conteo
   * refleje el estado actual del mes completo.
   *
   * 1. Cuenta envíos Flex únicos del mes (1 query)
   * 2. Determina el tier correcto según volumen
   * 3. Bulk UPDATE todos los pagos Flex del mes (normal + zona especial)
   */
  async recalculateMonthlyFaztCosts(
    sellerId: number,
    yearMonth: string,
  ): Promise<{
    shipments_count: number;
    rate_per_shipment: number;
    total_updated: number;
    year_month: string;
  }> {
    const config = await this.faztConfigRepository.findOne({
      where: { seller: { id: sellerId }, is_active: true },
    });

    if (!config) {
      this.logger.warn(`No hay config Fazt para vendedor ${sellerId}, omitiendo recálculo`);
      return { shipments_count: 0, rate_per_shipment: 0, total_updated: 0, year_month: yearMonth };
    }

    // 1. Contar envíos Flex únicos del mes (1 query)
    const shipmentsCount = await this.countUniqueFlexShipments(sellerId, yearMonth);

    // 2. Determinar tier y tarifa base
    const tier = this.findTierForVolume(config.rate_tiers, shipmentsCount);
    const effectiveServiceType = config.default_service_type || 'same_day_rm';
    const baseCost = effectiveServiceType === 'next_day_v_region'
      ? (tier?.next_day_v_region || 0)
      : (tier?.same_day_rm || 0);

    // 3. Calcular costos con IVA
    const normalSubtotal = baseCost;
    const normalIva = Math.round(normalSubtotal * IVA_RATE);
    const normalTotal = normalSubtotal + normalIva;

    const specialZoneSurcharge = Number(config.special_zone_surcharge) || 0;
    const specialSubtotal = baseCost + specialZoneSurcharge;
    const specialIva = Math.round(specialSubtotal * IVA_RATE);
    const specialTotal = specialSubtotal + specialIva;

    // 4. Rango de fechas del mes
    const [year, month] = yearMonth.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    const startDate = `${yearMonth}-01`;
    const endDate = `${yearMonth}-${String(lastDay).padStart(2, '0')}`;

    // Subquery para IDs de órdenes Flex del vendedor en el mes
    const flexOrderSubquery = `
      SELECT o.id FROM "order" o
      WHERE o."sellerId" = :sellerId
        AND o.date_approved >= :startDate
        AND o.date_approved < :endDateExclusive
        AND o.logistic_type IN ('self_service', 'self_service_cost')
    `;
    // endDate exclusivo: primer día del mes siguiente
    const endDateExclusive = month === 12
      ? `${year + 1}-01-01`
      : `${year}-${String(month + 1).padStart(2, '0')}-01`;

    const params = { sellerId, startDate, endDateExclusive };

    // 5. Bulk UPDATE zona normal (fazt_is_special_zone = false o NULL)
    const normalResult = await this.paymentRepository
      .createQueryBuilder()
      .update(Payment)
      .set({ fazt_cost: normalTotal })
      .where(`"orderId" IN (${flexOrderSubquery})`, params)
      .andWhere('(fazt_is_special_zone = false OR fazt_is_special_zone IS NULL)')
      .execute();

    // 6. Bulk UPDATE zona especial
    const specialResult = await this.paymentRepository
      .createQueryBuilder()
      .update(Payment)
      .set({ fazt_cost: specialTotal })
      .where(`"orderId" IN (${flexOrderSubquery})`, params)
      .andWhere('fazt_is_special_zone = true')
      .execute();

    const totalUpdated = (normalResult.affected || 0) + (specialResult.affected || 0);

    this.logger.log(
      `[Fazt Recálculo] ${yearMonth}: ${shipmentsCount} envíos, ` +
      `tier=${tier?.min_shipments}-${tier?.max_shipments}, ` +
      `tarifa=$${baseCost}+IVA=$${normalTotal}, ` +
      `pagos actualizados=${totalUpdated}`,
    );

    return {
      shipments_count: shipmentsCount,
      rate_per_shipment: normalTotal,
      total_updated: totalUpdated,
      year_month: yearMonth,
    };
  }

  /**
   * Encontrar el tier correspondiente al volumen de envíos
   */
  private findTierForVolume(
    tiers: FaztRateTier[],
    shipmentsCount: number,
  ): FaztRateTier | null {
    // Ordenar tiers por min_shipments
    const sortedTiers = [...tiers].sort((a, b) => a.min_shipments - b.min_shipments);

    for (const tier of sortedTiers) {
      const matchesMin = shipmentsCount >= tier.min_shipments;
      const matchesMax =
        tier.max_shipments === null || shipmentsCount <= tier.max_shipments;

      if (matchesMin && matchesMax) {
        return tier;
      }
    }

    // Si el volumen es menor al mínimo del primer tier, usar el primer tier
    if (sortedTiers.length > 0 && shipmentsCount < sortedTiers[0].min_shipments) {
      return sortedTiers[0];
    }

    // Si el volumen excede todos los tiers, usar el último (sin límite)
    const lastTier = sortedTiers[sortedTiers.length - 1];
    if (lastTier && lastTier.max_shipments === null) {
      return lastTier;
    }

    return null;
  }

  /**
   * Convertir entidad a resumen
   */
  private toSummary(config: FaztConfiguration): FaztConfigSummary {
    return {
      id: config.id,
      seller_id: config.seller?.id || 0,
      rate_tiers: config.rate_tiers,
      special_zone_surcharge: Number(config.special_zone_surcharge),
      xl_package_surcharge: Number(config.xl_package_surcharge),
      default_service_type: config.default_service_type,
      special_zone_city_ids: config.special_zone_city_ids || [],
      is_active: config.is_active,
      created_at: config.created_at,
      updated_at: config.updated_at,
    };
  }
}
