import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Product } from '../../products/entities/product.entity';

@Entity('reviews')
export class Review {
  @PrimaryGeneratedColumn()
  review_id: number;

  @Column()
  product_id: number;

  @Column({ type: 'varchar', length: 255 })
  customer_name: string;

  @Column({ type: 'varchar', length: 255 })
  customer_email: string;

  @Column({ type: 'int' })
  rating: number; // 1-5

  @Column({ type: 'varchar', length: 255, nullable: true })
  title: string;

  @Column({ type: 'text' })
  comment: string;

  @Column({ type: 'boolean', default: false })
  verified_purchase: boolean;

  @Column({ type: 'varchar', length: 255, nullable: true })
  order_number: string;

  @Column({ type: 'int', default: 0 })
  helpful_count: number;

  @Column({ type: 'boolean', default: true })
  is_approved: boolean;

  @CreateDateColumn()
  created_at: Date;

  @ManyToOne(() => Product, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product: Product;
}
