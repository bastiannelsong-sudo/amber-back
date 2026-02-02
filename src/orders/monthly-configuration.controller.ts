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
  MonthlyConfigurationService,
  MonthlyConfigSummary,
  UpsertMonthlyConfigDto,
} from './monthly-configuration.service';

/**
 * Controlador para configuracion mensual de costos
 *
 * Endpoints:
 * - GET /monthly-config: Obtener configuracion de un mes con metricas
 * - POST /monthly-config: Crear/actualizar configuracion mensual
 * - GET /monthly-config/months: Listar meses con ordenes
 */
@Controller('monthly-config')
export class MonthlyConfigurationController {
  private readonly logger = new Logger(MonthlyConfigurationController.name);

  constructor(
    private readonly monthlyConfigService: MonthlyConfigurationService,
  ) {}

  /**
   * Obtener configuracion mensual con metricas calculadas
   * GET /monthly-config?seller_id=123456&year_month=2025-01
   */
  @Get()
  async getMonthlyConfig(
    @Query('seller_id') sellerIdStr: string,
    @Query('year_month') yearMonth?: string,
  ): Promise<MonthlyConfigSummary> {
    const sellerId = this.validateSellerId(sellerIdStr);
    const effectiveYearMonth = yearMonth || this.getCurrentYearMonth();

    // Validar formato
    if (!/^\d{4}-\d{2}$/.test(effectiveYearMonth)) {
      throw new BadRequestException('Formato de year_month invalido. Use YYYY-MM');
    }

    return this.monthlyConfigService.getMonthlyConfig(sellerId, effectiveYearMonth);
  }

  /**
   * Crear o actualizar configuracion mensual
   * POST /monthly-config
   *
   * Body: {
   *   seller_id: number,
   *   year_month: string, // YYYY-MM
   *   packaging_cost_per_item?: number,
   *   notes?: string | null,
   *   is_closed?: boolean
   * }
   */
  @Post()
  async upsertMonthlyConfig(
    @Body()
    body: {
      seller_id: number;
      year_month: string;
      packaging_cost_per_item?: number;
      notes?: string | null;
      is_closed?: boolean;
    },
  ): Promise<MonthlyConfigSummary> {
    const { seller_id, year_month, ...dto } = body;

    if (!seller_id || seller_id <= 0) {
      throw new BadRequestException('seller_id valido es requerido');
    }

    if (!year_month || !/^\d{4}-\d{2}$/.test(year_month)) {
      throw new BadRequestException('year_month en formato YYYY-MM es requerido');
    }

    // Validar packaging_cost_per_item si se proporciona
    if (dto.packaging_cost_per_item !== undefined) {
      if (typeof dto.packaging_cost_per_item !== 'number' || dto.packaging_cost_per_item < 0) {
        throw new BadRequestException('packaging_cost_per_item debe ser un numero no negativo');
      }
    }

    this.logger.log(`Actualizando configuracion mensual para ${seller_id} en ${year_month}`);

    return this.monthlyConfigService.upsertMonthlyConfig(seller_id, year_month, dto);
  }

  /**
   * Listar meses con ordenes para un vendedor
   * GET /monthly-config/months?seller_id=123456
   *
   * Retorna array de year_month strings ordenados descendentemente
   */
  @Get('months')
  async listMonthsWithOrders(
    @Query('seller_id') sellerIdStr: string,
  ): Promise<{ seller_id: number; months: string[] }> {
    const sellerId = this.validateSellerId(sellerIdStr);

    const months = await this.monthlyConfigService.listMonthsWithOrders(sellerId);

    return {
      seller_id: sellerId,
      months,
    };
  }

  /**
   * Listar meses con configuracion guardada
   * GET /monthly-config/saved-months?seller_id=123456
   */
  @Get('saved-months')
  async listMonthsWithConfig(
    @Query('seller_id') sellerIdStr: string,
  ): Promise<{ seller_id: number; months: string[] }> {
    const sellerId = this.validateSellerId(sellerIdStr);

    const months = await this.monthlyConfigService.listMonthsWithConfig(sellerId);

    return {
      seller_id: sellerId,
      months,
    };
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
      throw new BadRequestException('seller_id debe ser un numero positivo');
    }

    return sellerId;
  }

  /**
   * Obtener ano-mes actual en formato YYYY-MM
   */
  private getCurrentYearMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
}
