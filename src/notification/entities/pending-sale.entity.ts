import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { Platform } from '../../products/entities/platform.entity';
import { Product } from '../../products/entities/product.entity';

export enum PendingSaleStatus {
  PENDING = 'pending',
  MAPPED = 'mapped',
  IGNORED = 'ignored',
}

@Entity('pending_sales')
export class PendingSale {
  @PrimaryGeneratedColumn()
  pending_sale_id: number;

  @Column()
  platform_id: number;

  @Column({ type: 'varchar', length: 255 })
  platform_order_id: string;

  @Column({ type: 'varchar', length: 255 })
  platform_sku: string;

  @Column({ type: 'int' })
  quantity: number;

  @Column({ type: 'timestamp' })
  sale_date: Date;

  @Column({ type: 'jsonb', nullable: true })
  raw_data: any;

  @Column({
    type: 'enum',
    enum: PendingSaleStatus,
    default: PendingSaleStatus.PENDING,
  })
  status: PendingSaleStatus;

  @Column({ nullable: true })
  mapped_to_product_id: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  resolved_by: string;

  @Column({ type: 'timestamp', nullable: true })
  resolved_at: Date;

  @CreateDateColumn()
  created_at: Date;

  // Relations
  @ManyToOne(() => Platform, { eager: true })
  @JoinColumn({ name: 'platform_id' })
  platform: Platform;

  @ManyToOne(() => Product, { eager: true, nullable: true })
  @JoinColumn({ name: 'mapped_to_product_id' })
  product: Product;
}
