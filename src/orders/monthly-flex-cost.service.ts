import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { MonthlyFlexCost } from './entities/monthly-flex-cost.entity';
import { Order } from './entities/order.entity';
import { User } from './entities/user.entity';

export interface CreateFlexCostDto {
  year_month: string; // YYYY-MM
  total_with_iva: number;
  notes?: string;
}

export interface UpdateFlexCostDto {
  total_with_iva?: number;
  notes?: string;
}

export interface FlexCostSummary {
  id: number;
  year_month: string;
  net_cost: number;
  iva_amount: number;
  total_cost: number;
  flex_orders_count: number;
  cost_per_order: number;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class MonthlyFlexCostService {
  private readonly logger = new Logger(MonthlyFlexCostService.name);
  private readonly IVA_RATE = 0.19;

  constructor(
    @InjectRepository(MonthlyFlexCost)
    private readonly flexCostRepository: Repository<MonthlyFlexCost>,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /**
   * Calculate IVA breakdown from total with IVA
   * Total = Net + IVA = Net + (Net * 0.19) = Net * 1.19
   * Net = Total / 1.19
   */
  private calculateIvaBreakdown(totalWithIva: number): {
    net_cost: number;
    iva_amount: number;
  } {
    const net_cost = Math.round((totalWithIva / (1 + this.IVA_RATE)) * 100) / 100;
    const iva_amount = Math.round((totalWithIva - net_cost) * 100) / 100;
    return { net_cost, iva_amount };
  }

  /**
   * Count Flex orders for a specific month
   * Flex orders have logistic_type: cross_docking, xd_drop_off, or self_service
   */
  async countFlexOrders(yearMonth: string, sellerId: number): Promise<number> {
    const [year, month] = yearMonth.split('-').map(Number);
    const startDate = new Date(year, month - 1, 1, 0, 0, 0);
    const endDate = new Date(year, month, 0, 23, 59, 59); // Last day of month

    const count = await this.orderRepository
      .createQueryBuilder('order')
      .where('order.seller_id = :sellerId', { sellerId })
      .andWhere('order.date_approved BETWEEN :startDate AND :endDate', {
        startDate,
        endDate,
      })
      .andWhere('order.logistic_type IN (:...types)', {
        types: ['cross_docking', 'xd_drop_off', 'self_service'],
      })
      .getCount();

    return count;
  }

  /**
   * Create or update monthly Flex cost
   */
  async upsert(
    sellerId: number,
    dto: CreateFlexCostDto,
  ): Promise<FlexCostSummary> {
    const { net_cost, iva_amount } = this.calculateIvaBreakdown(dto.total_with_iva);
    const flexOrdersCount = await this.countFlexOrders(dto.year_month, sellerId);

    // Find seller
    const seller = await this.userRepository.findOne({ where: { id: sellerId } });
    if (!seller) {
      throw new NotFoundException(`Seller ${sellerId} not found`);
    }

    // Check if record exists
    let flexCost = await this.flexCostRepository.findOne({
      where: {
        year_month: dto.year_month,
        seller: { id: sellerId },
      },
    });

    if (flexCost) {
      // Update existing
      flexCost.net_cost = net_cost;
      flexCost.iva_amount = iva_amount;
      flexCost.total_cost = dto.total_with_iva;
      flexCost.flex_orders_count = flexOrdersCount;
      flexCost.notes = dto.notes || null;
    } else {
      // Create new
      flexCost = this.flexCostRepository.create({
        year_month: dto.year_month,
        seller,
        net_cost,
        iva_amount,
        total_cost: dto.total_with_iva,
        flex_orders_count: flexOrdersCount,
        notes: dto.notes || null,
      });
    }

    const saved = await this.flexCostRepository.save(flexCost);

    return this.toSummary(saved);
  }

  /**
   * Get all monthly Flex costs for a seller
   */
  async findAll(sellerId: number): Promise<FlexCostSummary[]> {
    const costs = await this.flexCostRepository.find({
      where: { seller: { id: sellerId } },
      order: { year_month: 'DESC' },
    });

    return costs.map((c) => this.toSummary(c));
  }

  /**
   * Get Flex cost for a specific month
   */
  async findByMonth(
    sellerId: number,
    yearMonth: string,
  ): Promise<FlexCostSummary | null> {
    const cost = await this.flexCostRepository.findOne({
      where: {
        year_month: yearMonth,
        seller: { id: sellerId },
      },
    });

    return cost ? this.toSummary(cost) : null;
  }

  /**
   * Get Flex cost per order for a specific month
   * Returns 0 if no cost is registered
   */
  async getCostPerOrder(sellerId: number, yearMonth: string): Promise<number> {
    const cost = await this.findByMonth(sellerId, yearMonth);
    return cost?.cost_per_order || 0;
  }

  /**
   * Delete a monthly Flex cost record
   */
  async delete(sellerId: number, yearMonth: string): Promise<void> {
    const result = await this.flexCostRepository.delete({
      year_month: yearMonth,
      seller: { id: sellerId },
    });

    if (result.affected === 0) {
      throw new NotFoundException(
        `Flex cost for ${yearMonth} not found for seller ${sellerId}`,
      );
    }
  }

  /**
   * Convert entity to summary DTO
   */
  private toSummary(cost: MonthlyFlexCost): FlexCostSummary {
    const costPerOrder =
      cost.flex_orders_count > 0
        ? Math.round((cost.net_cost / cost.flex_orders_count) * 100) / 100
        : 0;

    return {
      id: cost.id,
      year_month: cost.year_month,
      net_cost: Number(cost.net_cost),
      iva_amount: Number(cost.iva_amount),
      total_cost: Number(cost.total_cost),
      flex_orders_count: cost.flex_orders_count,
      cost_per_order: costPerOrder,
      notes: cost.notes,
      created_at: cost.created_at,
      updated_at: cost.updated_at,
    };
  }
}
