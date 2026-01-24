import {
  Controller,
  Get,
  Post,
  Delete,
  Query,
  Body,
  Param,
  UsePipes,
  ValidationPipe,
  BadRequestException,
} from '@nestjs/common';
import {
  MonthlyFlexCostService,
  FlexCostSummary,
  CreateFlexCostDto,
} from './monthly-flex-cost.service';

/**
 * Monthly Flex Cost Controller
 * Manages external shipping costs for Flex orders
 *
 * The external shipping company charges a total monthly fee for all Flex shipments.
 * This controller allows storing and retrieving those costs to calculate accurate profits.
 */
@Controller('flex-costs')
export class MonthlyFlexCostController {
  constructor(private readonly flexCostService: MonthlyFlexCostService) {}

  /**
   * Get all monthly Flex costs for a seller
   * GET /flex-costs?seller_id=123
   */
  @Get()
  async getAll(
    @Query('seller_id') sellerIdStr: string,
  ): Promise<FlexCostSummary[]> {
    const sellerId = parseInt(sellerIdStr, 10);
    if (!sellerId || sellerId <= 0) {
      throw new BadRequestException('seller_id válido es requerido');
    }
    return this.flexCostService.findAll(sellerId);
  }

  /**
   * Get Flex cost for a specific month
   * GET /flex-costs/:yearMonth?seller_id=123
   */
  @Get(':yearMonth')
  async getByMonth(
    @Param('yearMonth') yearMonth: string,
    @Query('seller_id') sellerIdStr: string,
  ): Promise<FlexCostSummary | { message: string }> {
    const sellerId = parseInt(sellerIdStr, 10);
    if (!sellerId || sellerId <= 0) {
      throw new BadRequestException('seller_id válido es requerido');
    }

    // Validate year_month format (YYYY-MM)
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
      throw new BadRequestException('Formato de mes inválido. Use YYYY-MM');
    }

    const cost = await this.flexCostService.findByMonth(sellerId, yearMonth);
    if (!cost) {
      return { message: `No hay costo registrado para ${yearMonth}` };
    }
    return cost;
  }

  /**
   * Create or update monthly Flex cost
   * POST /flex-costs
   *
   * Body: {
   *   seller_id: number,
   *   year_month: "YYYY-MM",
   *   total_with_iva: number,
   *   notes?: string
   * }
   */
  @Post()
  async upsert(
    @Body()
    body: {
      seller_id: number;
      year_month: string;
      total_with_iva: number;
      notes?: string;
    },
  ): Promise<FlexCostSummary> {
    const { seller_id, year_month, total_with_iva, notes } = body;

    if (!seller_id || seller_id <= 0) {
      throw new BadRequestException('seller_id válido es requerido');
    }

    // Validate year_month format (YYYY-MM)
    if (!/^\d{4}-\d{2}$/.test(year_month)) {
      throw new BadRequestException('Formato de mes inválido. Use YYYY-MM');
    }

    if (!total_with_iva || total_with_iva < 0) {
      throw new BadRequestException('total_with_iva debe ser un número positivo');
    }

    return this.flexCostService.upsert(seller_id, {
      year_month,
      total_with_iva,
      notes,
    });
  }

  /**
   * Delete a monthly Flex cost
   * DELETE /flex-costs/:yearMonth?seller_id=123
   */
  @Delete(':yearMonth')
  async delete(
    @Param('yearMonth') yearMonth: string,
    @Query('seller_id') sellerIdStr: string,
  ): Promise<{ message: string }> {
    const sellerId = parseInt(sellerIdStr, 10);
    if (!sellerId || sellerId <= 0) {
      throw new BadRequestException('seller_id válido es requerido');
    }

    // Validate year_month format (YYYY-MM)
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
      throw new BadRequestException('Formato de mes inválido. Use YYYY-MM');
    }

    await this.flexCostService.delete(sellerId, yearMonth);
    return { message: `Costo Flex de ${yearMonth} eliminado correctamente` };
  }
}
