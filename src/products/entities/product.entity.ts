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
  to_repair: number;

  @Column({ type: 'int' })
  total: number;

  @OneToMany(() => SecondarySku, (secondarySku) => secondarySku.product)
  secondarySkus: SecondarySku[];

  @ManyToOne(() => Category, { onDelete: 'CASCADE' })
  category: Category;
}
