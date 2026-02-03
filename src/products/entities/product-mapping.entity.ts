import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';
import { Product } from './product.entity';
import { Platform } from './platform.entity';

@Entity('product_mappings')
@Unique(['platform_id', 'platform_sku', 'product_id'])
export class ProductMapping {
  @PrimaryGeneratedColumn()
  mapping_id: number;

  @Column()
  platform_id: number;

  @Column({ type: 'varchar', length: 255 })
  platform_sku: string;

  @Column()
  product_id: number;

  @Column({ type: 'int', default: 1 })
  quantity: number;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  created_by: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  // Relations
  @ManyToOne(() => Platform, { eager: true })
  @JoinColumn({ name: 'platform_id' })
  platform: Platform;

  @ManyToOne(() => Product, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product: Product;
}
