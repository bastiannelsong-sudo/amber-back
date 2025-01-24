import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { Product } from './product.entity';
import { Platform } from './platform.entity';

@Entity('secondary_skus')
export class SecondarySku {
  @PrimaryGeneratedColumn()
  secondary_sku_id: number;

  @Column({ type: 'varchar', length: 255})
  secondary_sku: string;

  @Column({ type: 'int' })
  stock_quantity: number;

  @Column({ type: 'varchar', length: 2083, nullable: true })
  publication_link: string;

  @ManyToOne(() => Product, (product) => product.secondarySkus, { onDelete: 'CASCADE' })
  product: Product;

  @ManyToOne(() => Platform, { onDelete: 'CASCADE' })
  platform: Platform;
}
