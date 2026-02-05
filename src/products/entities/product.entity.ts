import { Entity, PrimaryGeneratedColumn, Column, OneToMany, OneToOne, ManyToOne } from 'typeorm';
import { SecondarySku } from './secondary-sku.entity';
import { Category } from './category.entity';

@Entity('products')
export class Product {
  @PrimaryGeneratedColumn()
  product_id: number;

  @Column({ type: 'varchar', length: 255, unique: true })
  internal_sku: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'int' })
  stock: number;

  @Column({ type: 'int', default: 0 })
  stock_bodega: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  cost: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  price: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  image_url: string;

  @Column({ type: 'simple-json', nullable: true })
  images: string[];

  @OneToMany(
    () => SecondarySku,
    (secondarySku) => secondarySku.product,
    { cascade: true }
  )
  secondarySkus: SecondarySku[];

  @ManyToOne(() => Category, { onDelete: 'CASCADE' })
  category: Category;
}
