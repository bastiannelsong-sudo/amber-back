import { InjectRepository } from '@nestjs/typeorm';
import { Product } from './entities/product.entity';
import { Repository } from 'typeorm';
import { Category } from './entities/category.entity';
import { Platform } from './entities/platform.entity';
import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { CreateProductDto } from './dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { ProductHistoryService } from './services/product-history.service';
import { ProductHistory } from './entities/product-history.entity';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private productRepository: Repository<Product>,
    @InjectRepository(Category)
    private categoryRepository: Repository<Category>,
    @InjectRepository(Platform)
    private platformRepository: Repository<Platform>,
    private productHistoryService: ProductHistoryService,
  ) {}

  async createProduct(createProductDto: CreateProductDto) {
    // Buscar categoría
    const category = await this.categoryRepository.findOne({
      where: { platform_id: createProductDto.category_id },
    });
    if (!category) throw new NotFoundException('Categoría no encontrada');

    // Buscar plataformas para los SKUs secundarios
    const secondarySkus = await Promise.all(
      createProductDto.secondarySkus.map(async (sku) => {
        const platform = await this.platformRepository.findOne({
          where: { platform_id: sku.platform_id },
        });
        if (!platform) throw new NotFoundException('Plataforma no encontrada');
        return { ...sku, platform };
      }),
    );

    // Crear producto
    const product = this.productRepository.create({
      ...createProductDto,
      category,
      secondarySkus,
    });

    return this.productRepository.save(product);
  }


  findAll() {
    return this.productRepository
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.secondarySkus', 'secondarySkus') // Left join para incluir incluso cuando secondarySkus es null
      .leftJoinAndSelect('product.category', 'category')
      .orderBy('product.product_id', 'ASC')
      .getMany(); // Obtiene todos los productos
  }

  findOne(id: number) {
    return this.productRepository.findOne({ where: { product_id: id }, relations: ['secondarySkus'] });
  }

  /**
   * Actualizar producto con registro de historial
   */
  async updateProduct(id: number, updateDto: UpdateProductDto): Promise<Product> {
    // Obtener producto actual
    const product = await this.findOne(id);
    if (!product) {
      throw new NotFoundException(`Producto con ID ${id} no encontrado`);
    }

    // Verificar unicidad de SKU si se está cambiando
    if (updateDto.internal_sku && updateDto.internal_sku !== product.internal_sku) {
      const existing = await this.productRepository.findOne({
        where: { internal_sku: updateDto.internal_sku },
      });
      if (existing) {
        throw new ConflictException('El SKU interno ya existe');
      }
    }

    // Registrar cambios en historial
    const changedBy = updateDto.changed_by || 'Sistema';
    const changeReason = updateDto.change_reason || 'Actualización manual';
    const changes = [];

    for (const [field, newValue] of Object.entries(updateDto)) {
      // Ignorar campos de metadata
      if (['change_reason', 'changed_by', 'secondarySkus'].includes(field)) {
        continue;
      }

      const oldValue = product[field];

      // Solo registrar si cambió
      if (oldValue !== undefined && oldValue !== newValue) {
        changes.push({
          product_id: id,
          field_name: field,
          old_value: String(oldValue),
          new_value: String(newValue),
          changed_by: changedBy,
          change_type: 'manual',
          change_reason: changeReason,
        });
      }
    }

    // Guardar cambios en historial
    if (changes.length > 0) {
      await this.productHistoryService.createMany(changes);
    }

    // Preparar datos para actualización
    const updateData: any = { ...updateDto };
    delete updateData.change_reason;
    delete updateData.changed_by;
    delete updateData.secondarySkus;

    // Si se incluye category_id, buscar la categoría
    if (updateDto.category_id) {
      const category = await this.categoryRepository.findOne({
        where: { platform_id: updateDto.category_id },
      });
      if (!category) {
        throw new NotFoundException('Categoría no encontrada');
      }
      updateData.category = category;
      delete updateData.category_id;
    }

    // Actualizar producto
    await this.productRepository.save({
      ...product,
      ...updateData,
    });

    // Retornar producto actualizado con relaciones
    return this.findOne(id);
  }

  /**
   * Eliminar producto con registro en historial
   */
  async removeProduct(
    id: number,
    reason: string,
    changedBy: string,
  ): Promise<void> {
    const product = await this.findOne(id);
    if (!product) {
      throw new NotFoundException(`Producto con ID ${id} no encontrado`);
    }

    // Registrar eliminación
    await this.productHistoryService.create({
      product_id: id,
      field_name: 'deleted',
      old_value: 'false',
      new_value: 'true',
      changed_by: changedBy,
      change_type: 'manual',
      change_reason: reason,
    });

    // Eliminar físicamente
    await this.productRepository.delete(id);
  }

  /**
   * Ajustar stock manualmente
   */
  async adjustStock(id: number, adjustDto: AdjustStockDto): Promise<Product> {
    const product = await this.findOne(id);
    if (!product) {
      throw new NotFoundException(`Producto con ID ${id} no encontrado`);
    }

    const oldStock = product.stock;
    const newStock = oldStock + adjustDto.adjustment;

    if (newStock < 0) {
      throw new BadRequestException(
        `El stock no puede ser negativo. Stock actual: ${oldStock}, Ajuste: ${adjustDto.adjustment}`,
      );
    }

    // Registrar cambio
    await this.productHistoryService.create({
      product_id: id,
      field_name: 'stock',
      old_value: String(oldStock),
      new_value: String(newStock),
      changed_by: adjustDto.changed_by,
      change_type: 'adjustment',
      change_reason: adjustDto.reason,
    });

    // Actualizar stock
    product.stock = newStock;
    return await this.productRepository.save(product);
  }

  /**
   * Obtener historial de un producto
   */
  async getHistory(id: number, limit = 50): Promise<ProductHistory[]> {
    const product = await this.findOne(id);
    if (!product) {
      throw new NotFoundException(`Producto con ID ${id} no encontrado`);
    }

    return await this.productHistoryService.findByProduct(id, limit);
  }

  /**
   * Obtener productos con stock bajo
   */
  async getLowStock(threshold = 10): Promise<Product[]> {
    return await this.productRepository
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.category', 'category')
      .leftJoinAndSelect('product.secondarySkus', 'secondarySkus')
      .where('product.stock <= :threshold', { threshold })
      .orderBy('product.stock', 'ASC')
      .getMany();
  }

  // Mantener métodos originales por compatibilidad
  update(id: number, updateProductDto: CreateProductDto) {
    return this.productRepository.update(id, updateProductDto);
  }

  remove(id: number) {
    return this.productRepository.delete(id);
  }
}
