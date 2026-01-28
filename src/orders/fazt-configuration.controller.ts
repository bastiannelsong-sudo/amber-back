import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import {
  FaztConfigurationService,
  FaztConfigSummary,
  CurrentRateResult,
  CreateFaztConfigDto,
} from './fazt-configuration.service';
import { FaztRateTier } from './entities/fazt-configuration.entity';

/**
 * Controlador para configuración de tarifas de Fazt
 *
 * Endpoints:
 * - GET /fazt-config: Obtener configuración del vendedor
 * - POST /fazt-config: Crear/actualizar configuración
 * - GET /fazt-config/current-rate: Obtener tarifa actual según volumen del mes
 * - GET /fazt-config/shipments-count: Obtener conteo de envíos del mes
 */
@Controller('fazt-config')
export class FaztConfigurationController {
  private readonly logger = new Logger(FaztConfigurationController.name);

  constructor(
    private readonly faztConfigService: FaztConfigurationService,
  ) {}

  /**
   * Obtener configuración de Fazt para un vendedor
   * GET /fazt-config?seller_id=123456
   */
  @Get()
  async getConfiguration(
    @Query('seller_id') sellerIdStr: string,
  ): Promise<FaztConfigSummary | { message: string }> {
    const sellerId = this.validateSellerId(sellerIdStr);

    const config = await this.faztConfigService.getConfiguration(sellerId);

    if (!config) {
      return { message: `No hay configuración Fazt para vendedor ${sellerId}` };
    }

    return config;
  }

  /**
   * Crear o actualizar configuración de Fazt
   * POST /fazt-config
   *
   * Body: {
   *   seller_id: number,
   *   rate_tiers?: FaztRateTier[], // Opcional, usa valores por defecto si no se envía
   *   special_zone_surcharge?: number,
   *   xl_package_surcharge?: number,
   *   default_service_type?: 'same_day_rm' | 'next_day_v_region',
   *   special_zone_city_ids?: string[],
   *   is_active?: boolean
   * }
   */
  @Post()
  async upsertConfiguration(
    @Body()
    body: {
      seller_id: number;
      rate_tiers?: FaztRateTier[];
      special_zone_surcharge?: number;
      xl_package_surcharge?: number;
      default_service_type?: 'same_day_rm' | 'next_day_v_region';
      special_zone_city_ids?: string[];
      is_active?: boolean;
    },
  ): Promise<FaztConfigSummary> {
    const { seller_id, ...dto } = body;

    if (!seller_id || seller_id <= 0) {
      throw new BadRequestException('seller_id válido es requerido');
    }

    // Validar rate_tiers si se proporcionan
    if (dto.rate_tiers) {
      this.validateRateTiers(dto.rate_tiers);
    }

    // Validar service_type si se proporciona
    if (
      dto.default_service_type &&
      !['same_day_rm', 'next_day_v_region'].includes(dto.default_service_type)
    ) {
      throw new BadRequestException(
        'default_service_type debe ser "same_day_rm" o "next_day_v_region"',
      );
    }

    this.logger.log(`Actualizando configuración Fazt para vendedor ${seller_id}`);

    return this.faztConfigService.upsertConfiguration(seller_id, dto);
  }

  /**
   * Obtener tarifa actual según volumen del mes en curso
   * GET /fazt-config/current-rate?seller_id=123456
   */
  @Get('current-rate')
  async getCurrentRate(
    @Query('seller_id') sellerIdStr: string,
  ): Promise<CurrentRateResult> {
    const sellerId = this.validateSellerId(sellerIdStr);

    return this.faztConfigService.getCurrentRate(sellerId);
  }

  /**
   * Obtener conteo de envíos Flex únicos del mes
   * GET /fazt-config/shipments-count?seller_id=123456&year_month=2025-01
   */
  @Get('shipments-count')
  async getShipmentsCount(
    @Query('seller_id') sellerIdStr: string,
    @Query('year_month') yearMonth?: string,
  ): Promise<{ seller_id: number; year_month: string; unique_shipments: number }> {
    const sellerId = this.validateSellerId(sellerIdStr);

    // Usar mes actual si no se especifica
    const effectiveYearMonth =
      yearMonth || this.getCurrentYearMonth();

    // Validar formato de year_month
    if (!/^\d{4}-\d{2}$/.test(effectiveYearMonth)) {
      throw new BadRequestException('Formato de year_month inválido. Use YYYY-MM');
    }

    const count = await this.faztConfigService.countUniqueFlexShipments(
      sellerId,
      effectiveYearMonth,
    );

    return {
      seller_id: sellerId,
      year_month: effectiveYearMonth,
      unique_shipments: count,
    };
  }

  /**
   * Calcular costo de un envío específico
   * GET /fazt-config/calculate-cost?seller_id=123456&service_type=same_day_rm&city_id=ABC
   */
  @Get('calculate-cost')
  async calculateCost(
    @Query('seller_id') sellerIdStr: string,
    @Query('service_type') serviceType?: 'same_day_rm' | 'next_day_v_region',
    @Query('city_id') cityId?: string,
  ) {
    const sellerId = this.validateSellerId(sellerIdStr);

    return this.faztConfigService.calculateShipmentCost(
      sellerId,
      serviceType,
      cityId,
      false, // isXlPackage - no implementado aún
    );
  }

  /**
   * Validar y parsear seller_id
   */
  private validateSellerId(sellerIdStr: string): number {
    if (!sellerIdStr) {
      throw new BadRequestException('seller_id es requerido');
    }

    const sellerId = parseInt(sellerIdStr, 10);
    if (isNaN(sellerId) || sellerId <= 0) {
      throw new BadRequestException('seller_id debe ser un número positivo');
    }

    return sellerId;
  }

  /**
   * Validar estructura de rate_tiers
   */
  private validateRateTiers(tiers: FaztRateTier[]): void {
    if (!Array.isArray(tiers) || tiers.length === 0) {
      throw new BadRequestException('rate_tiers debe ser un array no vacío');
    }

    for (const tier of tiers) {
      if (typeof tier.min_shipments !== 'number' || tier.min_shipments < 0) {
        throw new BadRequestException('min_shipments debe ser un número no negativo');
      }
      if (tier.max_shipments !== null && typeof tier.max_shipments !== 'number') {
        throw new BadRequestException('max_shipments debe ser un número o null');
      }
      if (typeof tier.same_day_rm !== 'number' || tier.same_day_rm < 0) {
        throw new BadRequestException('same_day_rm debe ser un número no negativo');
      }
      if (typeof tier.next_day_v_region !== 'number' || tier.next_day_v_region < 0) {
        throw new BadRequestException('next_day_v_region debe ser un número no negativo');
      }
    }
  }

  /**
   * Obtener año-mes actual en formato YYYY-MM
   */
  private getCurrentYearMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
}
