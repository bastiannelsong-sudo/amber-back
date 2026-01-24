import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductHistory } from '../entities/product-history.entity';

export interface CreateHistoryDto {
  product_id: number;
  field_name: string;
  old_value: string;
  new_value: string;
  changed_by?: string;
  change_type?: string;
  change_reason?: string;
}

@Injectable()
export class ProductHistoryService {
  constructor(
    @InjectRepository(ProductHistory)
    private historyRepository: Repository<ProductHistory>,
  ) {}

  /**
   * Crear un nuevo registro de historial
   */
  async create(data: CreateHistoryDto): Promise<ProductHistory> {
    const history = this.historyRepository.create({
      ...data,
      changed_by: data.changed_by || 'Sistema',
      change_type: data.change_type || 'manual',
    });

    return await this.historyRepository.save(history);
  }

  /**
   * Obtener historial de un producto específico
   */
  async findByProduct(
    productId: number,
    limit = 50,
  ): Promise<ProductHistory[]> {
    return await this.historyRepository.find({
      where: { product_id: productId },
      order: { created_at: 'DESC' },
      take: limit,
    });
  }

  /**
   * Obtener historial reciente de todos los productos
   */
  async findRecent(limit = 100): Promise<ProductHistory[]> {
    return await this.historyRepository.find({
      relations: ['product'],
      order: { created_at: 'DESC' },
      take: limit,
    });
  }

  /**
   * Obtener historial por tipo de cambio
   */
  async findByType(
    changeType: string,
    limit = 50,
  ): Promise<ProductHistory[]> {
    return await this.historyRepository.find({
      where: { change_type: changeType },
      relations: ['product'],
      order: { created_at: 'DESC' },
      take: limit,
    });
  }

  /**
   * Registrar múltiples cambios en una transacción
   */
  async createMany(changes: CreateHistoryDto[]): Promise<ProductHistory[]> {
    const histories = changes.map((data) =>
      this.historyRepository.create({
        ...data,
        changed_by: data.changed_by || 'Sistema',
        change_type: data.change_type || 'manual',
      }),
    );

    return await this.historyRepository.save(histories);
  }
}
