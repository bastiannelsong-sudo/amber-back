import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Category } from '../entities/category.entity';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
    private readonly dataSource: DataSource,
  ) {}

  async findAll(): Promise<Category[]> {
    return this.categoryRepository.find({
      order: { platform_name: 'ASC' },
    });
  }

  async findAllWithProductCount(): Promise<
    Array<Category & { product_count: number }>
  > {
    const result = await this.dataSource.query(`
      SELECT
        c.platform_id,
        c.platform_name,
        COUNT(p.product_id)::int as product_count
      FROM categories c
      LEFT JOIN products p ON c.platform_id = p."categoryPlatformId"
      GROUP BY c.platform_id, c.platform_name
      ORDER BY c.platform_name ASC
    `);
    return result;
  }

  async findOne(id: number): Promise<Category> {
    const category = await this.categoryRepository.findOne({
      where: { platform_id: id },
    });
    if (!category) {
      throw new NotFoundException(`Categoría con ID ${id} no encontrada`);
    }
    return category;
  }

  async create(dto: CreateCategoryDto): Promise<Category> {
    // Check if name already exists
    const existing = await this.categoryRepository.findOne({
      where: { platform_name: dto.name },
    });
    if (existing) {
      throw new ConflictException(
        `Ya existe una categoría con el nombre "${dto.name}"`,
      );
    }

    // Get the next platform_id
    const result = await this.dataSource.query(
      'SELECT COALESCE(MAX(platform_id), 0) + 1 as next_id FROM categories',
    );
    const nextId = result[0].next_id;

    const category = this.categoryRepository.create({
      platform_id: nextId,
      platform_name: dto.name,
    });

    return this.categoryRepository.save(category);
  }

  async update(id: number, dto: UpdateCategoryDto): Promise<Category> {
    const category = await this.findOne(id);

    // Check if new name already exists (excluding current category)
    if (dto.name !== category.platform_name) {
      const existing = await this.categoryRepository.findOne({
        where: { platform_name: dto.name },
      });
      if (existing) {
        throw new ConflictException(
          `Ya existe una categoría con el nombre "${dto.name}"`,
        );
      }
    }

    category.platform_name = dto.name;
    return this.categoryRepository.save(category);
  }

  async remove(id: number): Promise<{ message: string }> {
    const category = await this.findOne(id);

    // Check if category has associated products
    const productCount = await this.dataSource.query(
      'SELECT COUNT(*)::int as count FROM products WHERE "categoryPlatformId" = $1',
      [id],
    );

    if (productCount[0].count > 0) {
      throw new BadRequestException(
        `No se puede eliminar la categoría "${category.platform_name}" porque tiene ${productCount[0].count} producto(s) asociado(s). Mueve los productos a otra categoría primero.`,
      );
    }

    await this.categoryRepository.remove(category);
    return {
      message: `Categoría "${category.platform_name}" eliminada correctamente`,
    };
  }

  async getProductCount(id: number): Promise<number> {
    const result = await this.dataSource.query(
      'SELECT COUNT(*)::int as count FROM products WHERE "categoryPlatformId" = $1',
      [id],
    );
    return result[0].count;
  }
}
