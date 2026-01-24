import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../entities/product.entity';
import { ProductHistory } from '../entities/product-history.entity';
import { ProductMapping } from '../entities/product-mapping.entity';

interface StockChangeMetadata {
  platform_id?: number;
  platform_order_id?: string;
  adjustment_amount?: number;
  change_type: 'manual' | 'order' | 'adjustment' | 'import';
  changed_by: string;
  change_reason: string;
  metadata?: any;
}

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(Product)
    private productRepository: Repository<Product>,
    @InjectRepository(ProductHistory)
    private historyRepository: Repository<ProductHistory>,
    @InjectRepository(ProductMapping)
    private mappingRepository: Repository<ProductMapping>,
  ) {}

  /**
   * Buscar producto por SKU de plataforma o SKU interno
   */
  async findProductBySku(
    platformId: number,
    sku: string,
  ): Promise<Product | null> {
    // Primero buscar por mapeo
    const mapping = await this.mappingRepository.findOne({
      where: {
        platform_id: platformId,
        platform_sku: sku,
        is_active: true,
      },
      relations: ['product'],
    });

    if (mapping) {
      return mapping.product;
    }

    // Si no hay mapeo, buscar por SKU interno
    const product = await this.productRepository.findOne({
      where: { internal_sku: sku },
      relations: ['category', 'secondarySkus', 'secondarySkus.platform'],
    });

    return product;
  }

  /**
   * Descontar stock de un producto
   */
  async deductStock(
    productId: number,
    quantity: number,
    metadata: StockChangeMetadata,
  ): Promise<Product> {
    const product = await this.productRepository.findOne({
      where: { product_id: productId },
    });

    if (!product) {
      throw new NotFoundException(`Producto con ID ${productId} no encontrado`);
    }

    const oldStock = product.stock;
    const newStock = oldStock - quantity;

    product.stock = newStock;
    await this.productRepository.save(product);

    // Registrar en historial
    await this.recordChange(
      productId,
      'stock',
      oldStock.toString(),
      newStock.toString(),
      -quantity,
      metadata,
    );

    return product;
  }

  /**
   * Restaurar stock de un producto
   */
  async restoreStock(
    productId: number,
    quantity: number,
    metadata: StockChangeMetadata,
  ): Promise<Product> {
    const product = await this.productRepository.findOne({
      where: { product_id: productId },
    });

    if (!product) {
      throw new NotFoundException(`Producto con ID ${productId} no encontrado`);
    }

    const oldStock = product.stock;
    const newStock = oldStock + quantity;

    product.stock = newStock;
    await this.productRepository.save(product);

    // Registrar en historial
    await this.recordChange(
      productId,
      'stock',
      oldStock.toString(),
      newStock.toString(),
      quantity,
      metadata,
    );

    return product;
  }

  /**
   * Validar disponibilidad de stock
   */
  async validateStockAvailability(
    productId: number,
    quantity: number,
  ): Promise<boolean> {
    const product = await this.productRepository.findOne({
      where: { product_id: productId },
    });

    if (!product) {
      return false;
    }

    return product.stock >= quantity;
  }

  /**
   * Registrar cambio en el historial
   */
  async recordChange(
    productId: number,
    fieldName: string,
    oldValue: string,
    newValue: string,
    adjustmentAmount: number | null,
    metadata: StockChangeMetadata,
  ): Promise<ProductHistory> {
    const historyEntry = this.historyRepository.create({
      product_id: productId,
      field_name: fieldName,
      old_value: oldValue,
      new_value: newValue,
      changed_by: metadata.changed_by,
      change_type: metadata.change_type,
      change_reason: metadata.change_reason,
      platform_id: metadata.platform_id,
      platform_order_id: metadata.platform_order_id,
      adjustment_amount: adjustmentAmount,
      metadata: metadata.metadata,
    });

    return await this.historyRepository.save(historyEntry);
  }
}
