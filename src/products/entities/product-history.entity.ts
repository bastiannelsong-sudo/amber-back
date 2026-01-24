import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Product } from './product.entity';
import { Platform } from './platform.entity';

@Entity('product_history')
export class ProductHistory {
  @PrimaryGeneratedColumn()
  history_id: number;

  @Column()
  product_id: number;

  @Column({ length: 100 })
  field_name: string; // "stock", "name", "price", etc.

  @Column({ type: 'text', nullable: true })
  old_value: string;

  @Column({ type: 'text', nullable: true })
  new_value: string;

  @Column({ length: 255, nullable: true })
  changed_by: string; // Usuario o "Sistema"

  @Column({ length: 50, default: 'manual' })
  change_type: string; // "manual", "order", "adjustment", "import"

  @Column({ type: 'text', nullable: true })
  change_reason: string; // Razón del cambio

  // Nuevos campos para trazabilidad multi-plataforma
  @Column({ nullable: true })
  platform_id: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  platform_order_id: string;

  @Column({ type: 'int', nullable: true })
  adjustment_amount: number; // +10, -5, etc.

  @Column({ type: 'jsonb', nullable: true })
  metadata: any; // Datos adicionales en formato JSON

  @CreateDateColumn()
  created_at: Date;

  @ManyToOne(() => Product, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @ManyToOne(() => Platform, { eager: true, nullable: true })
  @JoinColumn({ name: 'platform_id' })
  platform: Platform;
}
