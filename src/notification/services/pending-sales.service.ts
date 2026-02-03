import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PendingSale, PendingSaleStatus } from '../entities/pending-sale.entity';
import { ResolvePendingSaleDto } from '../dto/resolve-pending-sale.dto';
import { InventoryService } from '../../products/services/inventory.service';
import { ProductMappingService } from '../../products/services/product-mapping.service';

@Injectable()
export class PendingSalesService {
  private readonly logger = new Logger(PendingSalesService.name);

  constructor(
    @InjectRepository(PendingSale)
    private pendingSaleRepository: Repository<PendingSale>,
    private inventoryService: InventoryService,
    private mappingService: ProductMappingService,
  ) {}

  async create(data: Partial<PendingSale>): Promise<PendingSale> {
    const pendingSale = this.pendingSaleRepository.create(data);
    return await this.pendingSaleRepository.save(pendingSale);
  }

  async findAll(status?: PendingSaleStatus, platformId?: number): Promise<PendingSale[]> {
    const queryBuilder = this.pendingSaleRepository
      .createQueryBuilder('pending_sale')
      .leftJoinAndSelect('pending_sale.platform', 'platform')
      .leftJoinAndSelect('pending_sale.product', 'product')
      .orderBy('pending_sale.sale_date', 'DESC');

    // Solo mostrar ventas pendientes desde MIN_APPROVED_DATE
    const minDateStr = process.env.MIN_APPROVED_DATE || '';
    const minDate = new Date(minDateStr);
    if (!isNaN(minDate.getTime())) {
      queryBuilder.andWhere('pending_sale.sale_date >= :minDate', { minDate });
    }

    if (status) {
      queryBuilder.andWhere('pending_sale.status = :status', { status });
    }

    if (platformId) {
      queryBuilder.andWhere('pending_sale.platform_id = :platformId', { platformId });
    }

    return await queryBuilder.getMany();
  }

  async getCount(status: PendingSaleStatus = PendingSaleStatus.PENDING): Promise<number> {
    const qb = this.pendingSaleRepository
      .createQueryBuilder('pending_sale')
      .where('pending_sale.status = :status', { status });

    const minDateStr = process.env.MIN_APPROVED_DATE || '';
    const minDate = new Date(minDateStr);
    if (!isNaN(minDate.getTime())) {
      qb.andWhere('pending_sale.sale_date >= :minDate', { minDate });
    }

    return await qb.getCount();
  }

  async findById(id: number): Promise<PendingSale> {
    const sale = await this.pendingSaleRepository.findOne({
      where: { pending_sale_id: id },
      relations: ['platform', 'product'],
    });

    if (!sale) {
      throw new NotFoundException(`Venta pendiente con ID ${id} no encontrada`);
    }

    return sale;
  }

  async resolve(id: number, dto: ResolvePendingSaleDto): Promise<PendingSale> {
    const sale = await this.findById(id);

    const items = dto.items;

    // Descontar stock de cada producto
    for (const item of items) {
      await this.inventoryService.deductStock(item.product_id, item.quantity, {
        change_type: 'order',
        changed_by: dto.resolved_by,
        change_reason: `Venta pendiente resuelta - Orden ${sale.platform_order_id}`,
        platform_id: sale.platform_id,
        platform_order_id: sale.platform_order_id,
        adjustment_amount: -item.quantity,
        metadata: { pending_sale_id: id, ...sale.raw_data },
      });
    }

    // Crear mapeo para CADA producto si se solicitó
    if (dto.create_mapping) {
      for (const item of items) {
        try {
          await this.mappingService.create({
            platform_id: sale.platform_id,
            platform_sku: sale.platform_sku,
            product_id: item.product_id,
            quantity: item.quantity,
            created_by: dto.resolved_by,
          });
        } catch (error) {
          this.logger.warn(`Mapeo ya existe o no se pudo crear para producto ${item.product_id}: ${error.message}`);
        }
      }
    }

    // Actualizar venta pendiente
    sale.status = PendingSaleStatus.MAPPED;
    sale.mapped_to_product_id = items[0].product_id;
    sale.resolved_by = dto.resolved_by;
    sale.resolved_at = new Date();

    return await this.pendingSaleRepository.save(sale);
  }

  async ignore(id: number, resolvedBy: string): Promise<PendingSale> {
    const sale = await this.findById(id);

    sale.status = PendingSaleStatus.IGNORED;
    sale.resolved_by = resolvedBy;
    sale.resolved_at = new Date();

    return await this.pendingSaleRepository.save(sale);
  }
}
