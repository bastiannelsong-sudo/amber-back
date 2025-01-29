import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Product } from './entities/product.entity';
import { CreateProductDto, UpdateProductDto } from './dto';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
  ) {}

  create(createProductDto: CreateProductDto) {
    const product = this.productRepository.create(createProductDto);
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

  update(id: number, updateProductDto: UpdateProductDto) {
    return this.productRepository.update(id, updateProductDto);
  }

  remove(id: number) {
    return this.productRepository.delete(id);
  }
}
