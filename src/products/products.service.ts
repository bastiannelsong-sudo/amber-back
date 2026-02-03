import { InjectRepository } from '@nestjs/typeorm';
import { Product } from './entities/product.entity';
import { Repository } from 'typeorm';
import { Category } from './entities/category.entity';
import { Platform } from './entities/platform.entity';
import { SecondarySku } from './entities/secondary-sku.entity';
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
    @InjectRepository(SecondarySku)
    private secondarySkuRepository: Repository<SecondarySku>,
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
      .leftJoinAndSelect('product.secondarySkus', 'secondarySkus')
      .leftJoinAndSelect('secondarySkus.platform', 'platform')
      .leftJoinAndSelect('product.category', 'category')
      .orderBy('product.product_id', 'ASC')
      .getMany(); // Obtiene todos los productos
  }

  findOne(id: number) {
    return this.productRepository.findOne({
      where: { product_id: id },
      relations: ['secondarySkus', 'secondarySkus.platform', 'category']
    });
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
      // Ignorar campos de metadata y relaciones (category_id se maneja aparte)
      if (['change_reason', 'changed_by', 'secondarySkus', 'category_id'].includes(field)) {
        continue;
      }

      const oldValue = product[field];

      // Normalizar valores para comparación
      const normalizeValue = (val: any): string | number | null => {
        if (val === null || val === undefined) return null;
        // Si es número o string numérico, convertir a número
        if (typeof val === 'number' || (typeof val === 'string' && !isNaN(Number(val)) && val.trim() !== '')) {
          return Number(val);
        }
        return String(val).trim();
      };

      const normalizedOld = normalizeValue(oldValue);
      const normalizedNew = normalizeValue(newValue);

      // Solo registrar si realmente cambió
      if (normalizedOld !== undefined && normalizedOld !== normalizedNew) {
        changes.push({
          product_id: id,
          field_name: field,
          old_value: oldValue != null ? String(oldValue) : '',
          new_value: newValue != null ? String(newValue) : '',
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
    const secondarySkusData = updateData.secondarySkus;
    delete updateData.secondarySkus;

    // Si se incluye category_id, buscar la categoría y registrar cambio si es diferente
    if (updateDto.category_id) {
      const newCategory = await this.categoryRepository.findOne({
        where: { platform_id: updateDto.category_id },
      });
      if (!newCategory) {
        throw new NotFoundException('Categoría no encontrada');
      }

      // Registrar cambio de categoría si es diferente
      const oldCategoryId = product.category?.platform_id;
      if (oldCategoryId !== updateDto.category_id) {
        await this.productHistoryService.create({
          product_id: id,
          field_name: 'category',
          old_value: product.category?.platform_name || '',
          new_value: newCategory.platform_name,
          changed_by: changedBy,
          change_type: 'manual',
          change_reason: changeReason,
        });
      }

      updateData.category = newCategory;
      delete updateData.category_id;
    }

    // Actualizar producto base
    await this.productRepository.save({
      ...product,
      ...updateData,
    });

    // Actualizar SKUs secundarios si se proporcionaron
    if (secondarySkusData && Array.isArray(secondarySkusData)) {
      // Eliminar SKUs secundarios existentes
      await this.secondarySkuRepository.delete({ product: { product_id: id } });

      // Crear nuevos SKUs secundarios
      for (const skuData of secondarySkusData) {
        const platform = await this.platformRepository.findOne({
          where: { platform_id: skuData.platform_id },
        });
        if (!platform) {
          throw new NotFoundException(`Plataforma con ID ${skuData.platform_id} no encontrada`);
        }

        const newSku = this.secondarySkuRepository.create({
          secondary_sku: skuData.secondary_sku,
          stock_quantity: skuData.stock_quantity || 0,
          publication_link: skuData.publication_link || null,
          product: { product_id: id },
          platform: platform,
        });
        await this.secondarySkuRepository.save(newSku);
      }
    }

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
      .leftJoinAndSelect('secondarySkus.platform', 'platform')
      .where('product.stock <= :threshold', { threshold })
      .orderBy('product.stock', 'ASC')
      .getMany();
  }

  /**
   * Cambiar categoría de un producto
   */
  async changeCategory(
    productId: number,
    categoryId: number,
    changedBy: string = 'Usuario',
  ): Promise<Product> {
    const product = await this.findOne(productId);
    if (!product) {
      throw new NotFoundException(`Producto con ID ${productId} no encontrado`);
    }

    const newCategory = await this.categoryRepository.findOne({
      where: { platform_id: categoryId },
    });
    if (!newCategory) {
      throw new NotFoundException(`Categoría con ID ${categoryId} no encontrada`);
    }

    const oldCategoryName = product.category?.platform_name || 'Sin categoría';
    const newCategoryName = newCategory.platform_name;

    // Registrar cambio en historial
    await this.productHistoryService.create({
      product_id: productId,
      field_name: 'category',
      old_value: oldCategoryName,
      new_value: newCategoryName,
      changed_by: changedBy,
      change_type: 'manual',
      change_reason: `Cambio de categoría: ${oldCategoryName} → ${newCategoryName}`,
    });

    // Actualizar categoría
    product.category = newCategory;
    await this.productRepository.save(product);

    return this.findOne(productId);
  }

  /**
   * Cambiar categoría de múltiples productos
   */
  async bulkChangeCategory(
    productIds: number[],
    categoryId: number,
    changedBy: string = 'Usuario',
  ): Promise<{ updated: number; errors: string[] }> {
    const errors: string[] = [];
    let updated = 0;

    const newCategory = await this.categoryRepository.findOne({
      where: { platform_id: categoryId },
    });
    if (!newCategory) {
      throw new NotFoundException(`Categoría con ID ${categoryId} no encontrada`);
    }

    for (const productId of productIds) {
      try {
        await this.changeCategory(productId, categoryId, changedBy);
        updated++;
      } catch (error) {
        errors.push(`Producto ${productId}: ${error.message}`);
      }
    }

    return { updated, errors };
  }

  // Mantener métodos originales por compatibilidad
  update(id: number, updateProductDto: CreateProductDto) {
    return this.productRepository.update(id, updateProductDto);
  }

  remove(id: number) {
    return this.productRepository.delete(id);
  }
}
