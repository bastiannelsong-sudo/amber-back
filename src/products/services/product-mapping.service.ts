import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductMapping } from '../entities/product-mapping.entity';
import { CreateProductMappingDto } from '../dto/create-product-mapping.dto';

@Injectable()
export class ProductMappingService {
  constructor(
    @InjectRepository(ProductMapping)
    private mappingRepository: Repository<ProductMapping>,
  ) {}

  async create(dto: CreateProductMappingDto): Promise<ProductMapping> {
    // Verificar si ya existe un mapeo para este SKU de plataforma
    const existing = await this.mappingRepository.findOne({
      where: {
        platform_id: dto.platform_id,
        platform_sku: dto.platform_sku,
      },
    });

    if (existing) {
      throw new ConflictException(
        `Ya existe un mapeo para el SKU ${dto.platform_sku} en esta plataforma`,
      );
    }

    const mapping = this.mappingRepository.create(dto);
    return await this.mappingRepository.save(mapping);
  }

  async findAll(platformId?: number): Promise<ProductMapping[]> {
    if (platformId) {
      return await this.mappingRepository.find({
        where: { platform_id: platformId },
        relations: ['platform', 'product', 'product.category'],
        order: { created_at: 'DESC' },
      });
    }

    return await this.mappingRepository.find({
      relations: ['platform', 'product', 'product.category'],
      order: { created_at: 'DESC' },
    });
  }

  async findByPlatformSku(
    platformId: number,
    sku: string,
  ): Promise<ProductMapping | null> {
    return await this.mappingRepository.findOne({
      where: {
        platform_id: platformId,
        platform_sku: sku,
        is_active: true,
      },
      relations: ['product'],
    });
  }

  async findByProductId(productId: number): Promise<ProductMapping[]> {
    return await this.mappingRepository.find({
      where: { product_id: productId },
      relations: ['platform'],
    });
  }

  async toggleActive(id: number): Promise<ProductMapping> {
    const mapping = await this.mappingRepository.findOne({
      where: { mapping_id: id },
    });

    if (!mapping) {
      throw new NotFoundException(`Mapeo con ID ${id} no encontrado`);
    }

    mapping.is_active = !mapping.is_active;
    return await this.mappingRepository.save(mapping);
  }

  async delete(id: number): Promise<void> {
    const result = await this.mappingRepository.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`Mapeo con ID ${id} no encontrado`);
    }
  }
}
