import { InjectRepository } from '@nestjs/typeorm';
import { Product } from './entities/product.entity';
import { Repository } from 'typeorm';
import { Category } from './entities/category.entity';
import { Platform } from './entities/platform.entity';
import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateProductDto } from './dto';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private productRepository: Repository<Product>,
    @InjectRepository(Category)
    private categoryRepository: Repository<Category>,
    @InjectRepository(Platform)
    private platformRepository: Repository<Platform>,
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

  update(id: number, updateProductDto: CreateProductDto) {
    return this.productRepository.update(id, updateProductDto);
  }

  remove(id: number) {
    return this.productRepository.delete(id);
  }
}
